const https = require('https');

// 测试 API 返回的数据提取逻辑
const testUrl = 'https://x.com/elvissun/status/2025920521871716562';
const tweetId = '2025920521871716562';

function fetchFromFxTwitter(id) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.fxtwitter.com',
      path: `/status/${id}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 200 && json.tweet) resolve(json.tweet);
          else reject(new Error(json.message || 'API错误'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('超时')); });
    req.end();
  });
}

async function testExtract() {
  console.log('正在获取推文数据...');
  const tweet = await fetchFromFxTwitter(tweetId);
  
  console.log('\n=== 原始 text 字段 ===');
  console.log(JSON.stringify(tweet.text));
  
  console.log('\n=== Article 标题 ===');
  console.log(tweet.article?.title || '无');
  
  console.log('\n=== 新提取逻辑 ===');
  let text = tweet.text || '';
  let title = '';
  const inlineImages = [];
  
  if (!text && tweet.article) {
    title = tweet.article.title || '';
    if (tweet.article.content?.blocks) {
      const blocks = tweet.article.content.blocks;
      const entityMap = tweet.article.content.entityMap || {};
      
      const texts = [];
      for (const block of blocks) {
        if (block.text) {
          if (block.type === 'header-two') {
            texts.push(`## ${block.text}`);
          } else if (block.type === 'ordered-list-item') {
            texts.push(`1. ${block.text}`);
          } else if (block.type === 'unordered-list-item') {
            texts.push(`• ${block.text}`);
          } else {
            texts.push(block.text);
          }
        }
        if (block.type === 'atomic' && block.entityRanges) {
          for (const range of block.entityRanges) {
            const entity = entityMap[range.key];
            if (entity?.type === 'MEDIA' && entity.data?.mediaItems) {
              for (const item of entity.data.mediaItems) {
                if (item.mediaId) {
                  const mediaEntity = (tweet.article?.media_entities || tweet.media_entities || [])
                    .find(m => m.media_id === item.mediaId || m.id?.includes(item.mediaId));
                  if (mediaEntity?.media_info?.original_img_url) {
                    inlineImages.push(mediaEntity.media_info.original_img_url);
                  }
                }
              }
            }
          }
        }
      }
      text = texts.join('\n\n');
    }
    if (!text) text = tweet.article.preview_text || '';
  }
  if (title) text = `【${title}】\n\n${text}`;
  
  console.log('提取的文本长度:', text.length);
  console.log('\n提取的文本预览 (前500字):');
  console.log(text.substring(0, 500) + '...');
  
  console.log('\n=== 提取的图片 ===');
  const allImageUrls = [];
  
  if (tweet.article?.cover_media?.media_info?.original_img_url) {
    allImageUrls.push(tweet.article.cover_media.media_info.original_img_url);
    console.log('✓ 封面图:', tweet.article.cover_media.media_info.original_img_url);
  }
  
  inlineImages.forEach((url, i) => {
    if (!allImageUrls.includes(url)) {
      allImageUrls.push(url);
      console.log(`✓ 正文图片 ${i+1}:`, url);
    }
  });
  
  if (tweet.article?.media_entities) {
    for (const e of tweet.article.media_entities) {
      if (e.media_info?.original_img_url && !allImageUrls.includes(e.media_info.original_img_url)) {
        allImageUrls.push(e.media_info.original_img_url);
        console.log('✓ media_entities 图片:', e.media_info.original_img_url);
      }
    }
  }
  
  console.log('\n=== 结果 ===');
  console.log('文本非空:', text.length > 0 ? '✓ 是' : '✗ 否');
  console.log('图片数量:', allImageUrls.length);
}

testExtract().catch(console.error);
