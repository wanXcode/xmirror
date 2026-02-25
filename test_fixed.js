const https = require('https');
const path = require('path');
const fs = require('fs');

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
  console.log('Testing fix...');
  const tweet = await fetchFromFxTwitter(tweetId);
  const author = tweet.author || {};
  const media = tweet.media || {};
  
  // 提取文本 - 支持Article格式（先执行，收集 inlineImages）
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
  
  // 收集图片URL
  const allImageUrls = [];
  if (tweet.article?.cover_media?.media_info?.original_img_url) {
    allImageUrls.push(tweet.article.cover_media.media_info.original_img_url);
  }
  (media.photos || []).forEach(p => { if (p.url) allImageUrls.push(p.url); });
  if (tweet.media_entities) {
    for (const e of tweet.media_entities) {
      if (e.media_info?.original_img_url) allImageUrls.push(e.media_info.original_img_url);
    }
  }
  if (tweet.article?.media_entities) {
    for (const e of tweet.article.media_entities) {
      if (e.media_info?.original_img_url) allImageUrls.push(e.media_info.original_img_url);
    }
  }
  inlineImages.forEach(url => { if (!allImageUrls.includes(url)) allImageUrls.push(url); });
  
  console.log('\n=== 测试结果 ===');
  console.log('文本长度:', text.length);
  console.log('文本非空:', text.length > 0 ? '✓' : '✗');
  console.log('图片数量:', [...new Set(allImageUrls)].length);
  console.log('\n文本预览 (前200字):');
  console.log(text.substring(0, 200) + '...');
}

testExtract().catch(console.error);
