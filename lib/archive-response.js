const { canonicalizeXPostUrl } = require('./x-post');

class ArchiveError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.code = code;
  }
}

const errors = {
  INVALID_URL: [400, '请输入有效的 X / Twitter 推文或文章链接', false],
  SOURCE_UNAVAILABLE: [404, '暂时无法访问原文，请检查链接及原文访问权限', false],
  CONTENT_UNSUPPORTED: [400, '当前内容不支持存档', false],
  NETWORK_ERROR: [502, '连接内容服务失败，请稍后重试', true],
  REQUEST_TIMEOUT: [504, '等待超时，存档结果尚未确认，请稍后重试', true],
  SERVICE_UNAVAILABLE: [503, '服务暂时不可用，请稍后重试', true]
};

function normalizeArchiveUrl(value) {
  try {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) throw new Error('invalid URL');
    return canonicalizeXPostUrl(value);
  } catch (cause) {
    throw new ArchiveError('INVALID_URL', cause);
  }
}

function archiveErrorResponse(error) {
  let code = error?.code;
  if (code === 'CONTENT_MODERATION_REJECTED') code = 'CONTENT_UNSUPPORTED';
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) code = 'REQUEST_TIMEOUT';
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)) code = 'NETWORK_ERROR';
  if (!errors[code]) code = 'SERVICE_UNAVAILABLE';
  const [status, message, retryable] = errors[code];
  return { status, body: { success: false, code, error: message, retryable } };
}

function readSourceResponse(status, json) {
  const code = Number(json?.code) || status;
  if (status === 200 && code === 200 && json?.tweet) return json.tweet;
  if ([401, 403, 404].includes(status) || [401, 403, 404].includes(code)) {
    throw new ArchiveError('SOURCE_UNAVAILABLE');
  }
  throw new ArchiveError('SERVICE_UNAVAILABLE');
}

function archiveTitle(content = '') {
  const heading = String(content).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const text = (heading ? heading[1] : String(content)).replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#039|#39);/g, entity => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'"
    }[entity])).replace(/\s+/g, ' ').trim().replace(/^【(.+)】$/, '$1');
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function archiveSuccessResponse(post, cached = false) {
  return {
    success: true,
    id: post.id,
    url: `/${post.short_code}`,
    short_code: post.short_code,
    message: cached ? '已存在' : '存档成功',
    cached,
    author: post.author || '',
    title: archiveTitle(post.content),
    preview: String(post.content || '').slice(0, 100),
    video_status: post.video_status || (post.video ? 'completed' : post.video_source_url ? 'queued' : 'none')
  };
}

module.exports = { ArchiveError, normalizeArchiveUrl, archiveErrorResponse, readSourceResponse, archiveSuccessResponse };
