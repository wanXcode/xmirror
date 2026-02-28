const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));
app.use('/archives', express.static('archives'));
app.use('/images', express.static('data/images'));
app.use('/videos', express.static('data/videos'));

const db = new sqlite3.Database('./data/db.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    author TEXT,
    author_handle TEXT,
    author_avatar TEXT,
    content TEXT,
    images TEXT,
    video TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tweet_time TEXT,
    html_file TEXT
  )`);
});

function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

async function fetchFromFxTwitter(tweetId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.fxtwitter.com',
      path: `/status/${tweetId}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    const req = https.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(data);
          const json = JSON.parse(buffer.toString('utf8'));
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

async function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(__dirname, 'data', 'images', filename);
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(`/images/${filename}`); });
    }).on('error', reject);
  });
}

async function downloadVideo(url, filename) {
  return new Promise((resolve, reject) => {
    const videoDir = path.join(__dirname, 'data', 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    const filePath = path.join(videoDir, filename);
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败，状态码: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(`/videos/${filename}`); });
    }).on('error', (err) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      reject(err);
    });
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function extractSummary(content) {
  // 提取纯文本摘要，用于 meta description
  if (!content) return '';
  return content.replace(/<[^>]+>/g, '').substring(0, 200);
}

async function fetchXPost(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error('无法提取推文ID');
  
  const tweet = await fetchFromFxTwitter(tweetId);
  const author = tweet.author || {};
  const media = tweet.media || {};
  
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
  
  const uniqueUrls = [...new Set(allImageUrls)];
  
  const localImages = [];
  const urlToLocalPath = new Map();
  for (let i = 0; i < uniqueUrls.length; i++) {
    const ext = uniqueUrls[i].split('.').pop().split('?')[0] || 'jpg';
    const filename = `${tweetId}_${i}.${ext}`;
    try {
      const localPath = await downloadImage(uniqueUrls[i], filename);
      localImages.push(localPath);
      urlToLocalPath.set(uniqueUrls[i], localPath);
    } catch { 
      localImages.push(uniqueUrls[i]); 
      urlToLocalPath.set(uniqueUrls[i], uniqueUrls[i]);
    }
  }
  
  let localVideoPath = null;
  const videoUrl = media.videos?.[0]?.url;
  if (videoUrl) {
    const videoExt = videoUrl.split('.').pop().split('?')[0] || 'mp4';
    const videoFilename = `${tweetId}_video.${videoExt}`;
    try {
      localVideoPath = await downloadVideo(videoUrl, videoFilename);
      console.log(`视频下载成功: ${localVideoPath}`);
    } catch (err) {
      console.error(`视频下载失败: ${err.message}`);
      localVideoPath = videoUrl;
    }
  }
  
  let htmlContent = '';
  let title = '';
  
  const allMediaEntities = [
    ...(tweet.article?.media_entities || []),
    ...(tweet.media_entities || [])
  ];
  
  if (tweet.text) {
    htmlContent = escapeHtml(tweet.text).replace(/\n/g, '<br>');
    
    if (localImages.length > 0) {
      htmlContent += '<br><br>';
      for (const imgPath of localImages) {
        htmlContent += `<img src="${imgPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
      }
    }
  } else if (tweet.article) {
    title = tweet.article.title || '';
    
    if (tweet.article.content?.blocks) {
      const blocks = tweet.article.content.blocks;
      const entityMapArray = tweet.article.content.entityMap || [];
      const entityMap = {};
      for (const item of entityMapArray) {
        if (item.key !== undefined && item.value !== undefined) {
          entityMap[item.key] = item.value;
        }
      }
      
      for (const block of blocks) {
        if (block.text) {
          const text = escapeHtml(block.text).replace(/\n/g, '<br>');
          if (block.type === 'header-two') {
            htmlContent += `<h2>${text}</h2>`;
          } else if (block.type === 'ordered-list-item') {
            htmlContent += `<p>1. ${text}</p>`;
          } else if (block.type === 'unordered-list-item') {
            htmlContent += `<p>• ${text}</p>`;
          } else {
            htmlContent += `<p>${text}</p>`;
          }
        }
        
        if (block.type === 'atomic' && block.entityRanges) {
          for (const range of block.entityRanges) {
            const entity = entityMap[range.key];
            if (entity?.type === 'MEDIA' && entity.data?.mediaItems) {
              for (const item of entity.data.mediaItems) {
                if (item.mediaId) {
                  const mediaEntity = allMediaEntities.find(m => m.media_id === item.mediaId || m.id?.includes(item.mediaId));
                  if (mediaEntity?.media_info?.original_img_url) {
                    const originalUrl = mediaEntity.media_info.original_img_url;
                    const localPath = urlToLocalPath.get(originalUrl) || originalUrl;
                    htmlContent += `<img src="${localPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
                  }
                }
              }
            }
          }
        }
      }
    }
    
    let imgIndex = 0;
    htmlContent = htmlContent.replace(/XIMGPH_\d+/g, () => {
      const mediaEntity = allMediaEntities[imgIndex];
      imgIndex++;
      if (mediaEntity?.media_info?.original_img_url) {
        const originalUrl = mediaEntity.media_info.original_img_url;
        const localPath = urlToLocalPath.get(originalUrl) || originalUrl;
        return `<img src="${localPath}" style="max-width:100%;margin:10px 0;border-radius:8px;">`;
      }
      return '';
    });
    
    if (!htmlContent && tweet.article.preview_text) {
      htmlContent = escapeHtml(tweet.article.preview_text).replace(/\n/g, '<br>');
    }
  }
  
  if (title) {
    htmlContent = `<h1>【${escapeHtml(title)}】</h1>` + htmlContent;
  }
  
  return {
    author: author.name || '未知用户',
    author_handle: author.screen_name || 'unknown',
    author_avatar: author.avatar_url || '',
    content: htmlContent,
    images: localImages,
    video: localVideoPath,
    tweet_time: tweet.created_timestamp
  };
}

function generateMirrorHtml(post) {
  const content = post.content || '';
  const videoHtml = post.video ? `<video controls style="max-width:100%;margin:10px 0;"><source src="${post.video}" type="video/mp4"></video>` : '';
  
  // 提取摘要用于 meta 标签
  const summary = extractSummary(content);
  const ogImage = post.images && post.images.length > 0 ? post.images[0] : '';
  // 提取标题（优先用 h1/h2，否则取内容前40字）
  let articleTitle = '';
  const h1Match = content.match(/<h1[^>]*>(.+?)<\/h1>/i);
  const h2Match = content.match(/<h2[^>]*>(.+?)<\/h2>/i);
  if (h1Match) articleTitle = h1Match[1].replace(/<[^>]+>/g, '').substring(0, 50);
  else if (h2Match) articleTitle = h2Match[1].replace(/<[^>]+>/g, '').substring(0, 50);
  else articleTitle = summary.substring(0, 25);
  if (articleTitle.length >= 25) articleTitle += "...";
  const pageTitle = articleTitle ? `${escapeHtml(articleTitle)} | XMirror` : `${escapeHtml(post.author)} | XMirror`;
  const canonicalUrl = `https://x.5666.net/archives/${post.html_file}`;
  const createdAt = post.tweet_time || post.created_at || new Date().toISOString();
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pageTitle}</title>
<meta name="description" content="${escapeHtml(summary)}">
<meta name="keywords" content="X存档,Twitter存档,${escapeHtml(post.author)},推文备份,XMirror">
<meta name="author" content="${escapeHtml(post.author)}">
<meta name="robots" content="index, follow">
<meta name="googlebot" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">

<!-- Open Graph -->
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${escapeHtml(summary)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:site_name" content="XMirror">
<meta property="og:locale" content="zh_CN">
<meta property="article:published_time" content="${createdAt}">
<meta property="article:author" content="${escapeHtml(post.author)}">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${escapeHtml(summary)}">
<meta name="twitter:image" content="${ogImage}">
<meta name="twitter:creator" content="@${escapeHtml(post.author_handle)}">
<meta name="twitter:domain" content="x.5666.net">

<!-- Structured Data -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SocialMediaPosting",
  "headline": "${escapeHtml(summary).substring(0, 60)}",
  "description": "${escapeHtml(summary)}",
  "image": "${ogImage}",
  "url": "${canonicalUrl}",
  "datePublished": "${createdAt}",
  "author": {
    "@type": "Person",
    "name": "${escapeHtml(post.author)}",
    "identifier": "@${escapeHtml(post.author_handle)}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "XMirror",
    "url": "https://x.5666.net"
  },
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "${canonicalUrl}"
  }
}
</script>

<style>
:root {
  --bg-color: #ffffff;
  --text-primary: #0f1419;
  --text-secondary: #536471;
  --border-color: #eff3f4;
  --link-color: #1d9bf0;
  --hover-bg: rgba(15,20,25,0.1);
  --card-shadow: 0 0 15px rgba(0,0,0,0.08);
}
[data-theme="dark"] {
  --bg-color: #15202b;
  --text-primary: #e7e9ea;
  --text-secondary: #8899a6;
  --border-color: #38444d;
  --link-color: #1d9bf0;
  --hover-bg: rgba(255,255,255,0.1);
  --card-shadow: 0 0 15px rgba(0,0,0,0.3);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg-color);color:var(--text-primary);min-height:100vh;padding:20px;transition:background .3s,color .3s}
.theme-toggle{position:fixed;top:20px;right:20px;width:44px;height:44px;border-radius:50%;border:none;background:var(--hover-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:20px;z-index:100;transition:transform .2s}
.theme-toggle:hover{transform:scale(1.1)}
.container{max-width:600px;margin:30px auto 20px}
.post{background:var(--bg-color);border:1px solid var(--border-color);border-radius:16px;padding:20px;box-shadow:var(--card-shadow);transition:border-color .3s}
.header{display:flex;align-items:flex-start;margin-bottom:12px}
.avatar{width:48px;height:48px;border-radius:50%;margin-right:12px;object-fit:cover;background:var(--border-color)}
.author-info{flex:1}
.author-name{font-weight:700;font-size:16px;color:var(--text-primary);display:flex;align-items:center;gap:4px}
.author-handle{color:var(--text-secondary);font-size:15px}
.content{margin:4px 0;font-size:17px;line-height:1.6;word-wrap:break-word;color:var(--text-primary)}
.content h1{font-size:20px;font-weight:800;margin:16px 0}
.content h2{font-size:18px;font-weight:700;margin:14px 0}
.content p{margin:12px 0}
.content a{color:var(--link-color);text-decoration:none}
.content a:hover{text-decoration:underline}
.content img,.media-img{max-width:100%;border-radius:16px;margin:12px 0;border:1px solid var(--border-color)}
video{max-width:100%;border-radius:16px;margin:12px 0}
.meta{display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color);color:var(--text-secondary);font-size:14px}
.source{color:var(--link-color);text-decoration:none}
.source:hover{text-decoration:underline}
.badge{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600}
.time{display:flex;align-items:center;gap:8px}
@media(max-width:600px){body{padding:10px}.container{margin:50px 0 10px}.post{border-radius:12px}}
</style>
</head>
<body>
<button class="theme-toggle" onclick="toggleTheme()" title="切换主题">🌓</button>
<div class="container">
<div class="post">
<div class="header">
<img class="avatar" src="${post.author_avatar}" onerror="this.style.display='none'">
<div class="author-info">
<div class="author-name">${escapeHtml(post.author)}</div>
<div class="author-handle">@${escapeHtml(post.author_handle)}</div>
</div>
</div>
<div class="content">${content}</div>
${videoHtml}
<div class="meta">
<div class="time">
<span>${new Date(createdAt).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
<span>·</span>
<a class="source" href="${post.url}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>
</div>
<span class="badge">🐦 XMirror</span>
</div>
</div>
</div>
<script>
function getPreferredTheme() {
  const saved = localStorage.getItem('xmirror-theme');
  if (saved) return saved;
  const hour = new Date().getHours();
  return (hour >= 6 && hour < 18) ? 'light' : 'dark';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('xmirror-theme', theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
applyTheme(getPreferredTheme());
</script>
</body>
</html>`;
  
  return html;
}app.post('/api/archive', async (req, res) => {
  const {url} = req.body;
  if (!url?.includes('x.com') && !url?.includes('twitter.com')) return res.status(400).json({error:'无效的X链接'});
  
  try {
    const existing = await new Promise((r,j)=>db.get('SELECT * FROM posts WHERE url=?',[url],(e,row)=>e?j(e):r(row)));
    if (existing) {
      const htmlPath = path.join(__dirname,'archives',existing.html_file);
      if (!fs.existsSync(htmlPath)) {
        const htmlContent = generateMirrorHtml(existing);
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
      }
      return res.json({success:true,id:existing.id,url:`/archives/${existing.html_file}`,message:'已存在',cached:true});
    }
    
    const content = await fetchXPost(url);
    if (!content.content && content.images.length===0 && !content.video) return res.status(500).json({error:'未能获取推文内容'});
    
    let title = '';
    const h1Match = content.content.match(/<h1>(.+?)<\/h1>/);
    if (h1Match) {
      title = h1Match[1].replace(/【(.+?)】/, '$1');
    } else {
      title = content.content.replace(/<[^>]+>/g, '').substring(0, 50);
      if (content.content.replace(/<[^>]+>/g, '').length > 50) title += '...';
    }
    
    const timestamp = Date.now();
    const htmlFile = `post_${timestamp}.html`;
    
    const result = await new Promise((r,j)=>db.run('INSERT INTO posts(url,author,author_handle,author_avatar,content,images,video,tweet_time,html_file)VALUES(?,?,?,?,?,?,?,?,?)',
      [url,content.author,content.author_handle,content.author_avatar,content.content,JSON.stringify(content.images),content.video,content.tweet_time,htmlFile],function(e){e?j(e):r(this.lastID)}));
    
    const htmlContent = generateMirrorHtml({id:result,url,...content});
    fs.writeFileSync(path.join(__dirname,'archives',htmlFile), htmlContent, 'utf8');
    res.json({success:true,id:result,url:`/archives/${htmlFile}`,message:'存档成功',author:content.author,title:title,preview:content.content.substring(0,100)});
  } catch(e) {
    res.status(500).json({error:e.message||'抓取失败'});
  }
});

app.get('/api/posts', (req,res)=>db.all('SELECT * FROM posts ORDER BY created_at DESC',(e,r)=>e?res.status(500).json({error:e.message}):res.json(r)));

app.post('/api/delete', async (req, res) => {
  const {id} = req.body;
  if (!id) return res.status(400).json({error:'缺少存档ID'});
  
  try {
    const post = await new Promise((r,j)=>db.get('SELECT * FROM posts WHERE id=?',[id],(e,row)=>e?j(e):r(row)));
    if (!post) return res.status(404).json({error:'存档不存在'});
    
    const htmlPath = path.join(__dirname,'archives',post.html_file);
    if (fs.existsSync(htmlPath)) {
      fs.unlinkSync(htmlPath);
    }
    
    let images = [];
    try { images = JSON.parse(post.images || '[]'); } catch {}
    for (const imgPath of images) {
      const imgFullPath = path.join(__dirname, imgPath.replace(/^\//, ''));
      if (fs.existsSync(imgFullPath)) {
        fs.unlinkSync(imgFullPath);
      }
    }
    
    if (post.video && post.video.startsWith('/videos/')) {
      const videoFullPath = path.join(__dirname, post.video.replace(/^\//, ''));
      if (fs.existsSync(videoFullPath)) {
        fs.unlinkSync(videoFullPath);
      }
    }
    
    await new Promise((r,j)=>db.run('DELETE FROM posts WHERE id=?',[id],(e)=>e?j(e):r()));
    
    res.json({success:true,message:'删除成功'});
  } catch(e) {
    res.status(500).json({error:e.message||'删除失败'});
  }
});

app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`XMirror运行在http://0.0.0.0:${PORT}`));