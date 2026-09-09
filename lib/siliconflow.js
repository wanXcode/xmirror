function parseProviderError(text = '') {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isDisabledModelError(status, text) {
  const error = parseProviderError(text);
  return status === 403 && (error?.code === 30003 || error?.message === 'Model disabled.');
}

class TranslationProviderError extends Error {
  constructor(message, { status, code, cause } = {}) {
    super(message, { cause });
    this.name = 'TranslationProviderError';
    this.providerStatus = status;
    this.providerCode = code;
  }
}

async function createChatCompletion({ baseUrl, apiKey, models, body, fetchImpl = fetch, timeoutMs = 40000 }) {
  let lastError;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...body, model }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        throw new TranslationProviderError('翻译服务请求超时', { code: 'TIMEOUT', cause: error });
      }
      throw new TranslationProviderError('无法连接翻译服务', { code: 'NETWORK', cause: error });
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      try {
        return { json: await response.json(), model };
      } catch (error) {
        throw new TranslationProviderError('翻译服务返回了无效数据', { status: response.status, code: 'INVALID_RESPONSE', cause: error });
      }
    }

    const text = await response.text();
    const providerError = parseProviderError(text);
    lastError = new TranslationProviderError(`翻译服务错误(${response.status}): ${text.slice(0, 180)}`, {
      status: response.status,
      code: providerError?.code
    });
    const hasFallback = index < models.length - 1;
    if (!hasFallback || !isDisabledModelError(response.status, text)) throw lastError;

    console.warn(`翻译模型 ${model} 已停用，自动切换到 ${models[index + 1]}`);
  }

  throw lastError || new Error('翻译服务不可用');
}

module.exports = { createChatCompletion, isDisabledModelError, TranslationProviderError };
