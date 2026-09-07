function normalizeXTimestamp(value, fallback = new Date().toISOString()) {
  if (value === null || value === undefined || value === '') return fallback;

  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function isBrokenArticleArchive(content = '') {
  const textOnly = String(content)
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();

  return /^https:\/\/x\.com\/i\/article\/\d+$/.test(textOnly);
}

function renderTweetContent({ tweet, localImages = [], urlToLocalPath = new Map(), escapeHtml }) {
  let htmlContent = '';
  let title = '';
  const article = tweet.article;
  const allMediaEntities = [
    ...(article?.media_entities || []),
    ...(tweet.media_entities || [])
  ];

  // X Articles also expose an internal article URL through tweet.text. The
  // structured article must win or the archive becomes only that URL + images.
  if (article) {
    title = article.title || '';

    if (article.content?.blocks) {
      const rawEntityMap = article.content.entityMap || [];
      const entityMap = Array.isArray(rawEntityMap)
        ? Object.fromEntries(rawEntityMap
          .filter(item => item?.key !== undefined && item?.value !== undefined)
          .map(item => [item.key, item.value]))
        : rawEntityMap;

      for (const block of article.content.blocks) {
        if (block.text) {
          const text = escapeHtml(block.text).replace(/\n/g, '<br>');
          if (block.type === 'header-one') htmlContent += `<h1>${text}</h1>`;
          else if (block.type === 'header-two') htmlContent += `<h2>${text}</h2>`;
          else if (block.type === 'ordered-list-item') htmlContent += `<p>1. ${text}</p>`;
          else if (block.type === 'unordered-list-item') htmlContent += `<p>• ${text}</p>`;
          else if (block.type !== 'atomic') htmlContent += `<p>${text}</p>`;
        }

        if (block.type === 'atomic' && block.entityRanges) {
          for (const range of block.entityRanges) {
            const entity = entityMap[range.key];
            if (entity?.type !== 'MEDIA' || !entity.data?.mediaItems) continue;

            for (const item of entity.data.mediaItems) {
              if (!item.mediaId) continue;
              const mediaEntity = allMediaEntities.find(media =>
                media.media_id === item.mediaId || media.id?.includes(item.mediaId));
              if (!mediaEntity?.media_info?.original_img_url) continue;

              const originalUrl = mediaEntity.media_info.original_img_url;
              const localPath = urlToLocalPath.get(originalUrl) || originalUrl;
              htmlContent += `<img src="${localPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
            }
          }
        }
      }
    }

    let imgIndex = 0;
    htmlContent = htmlContent.replace(/XIMGPH_\d+/g, () => {
      const mediaEntity = allMediaEntities[imgIndex++];
      if (!mediaEntity?.media_info?.original_img_url) return '';
      const originalUrl = mediaEntity.media_info.original_img_url;
      const localPath = urlToLocalPath.get(originalUrl) || originalUrl;
      return `<img src="${localPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
    });

    if (!htmlContent && article.preview_text) {
      htmlContent = escapeHtml(article.preview_text).replace(/\n/g, '<br>');
    }
  } else if (tweet.text) {
    htmlContent = escapeHtml(tweet.text).replace(/\n/g, '<br>');
    if (localImages.length > 0) {
      htmlContent += '<br><br>';
      for (const imgPath of localImages) {
        htmlContent += `<img src="${imgPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
      }
    }
  }

  if (title && !/^\s*<h1[\s>]/i.test(htmlContent)) {
    htmlContent = `<h1>【${escapeHtml(title)}】</h1>` + htmlContent;
  }

  return { htmlContent, title };
}

module.exports = { isBrokenArticleArchive, normalizeXTimestamp, renderTweetContent };
