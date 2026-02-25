const https = require('https');

const tweetId = '2021240338908876854';

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
    const buffer = Buffer.concat(data);
    const json = JSON.parse(buffer.toString('utf8'));
    
    console.log('=== Tweet Structure ===');
    console.log('Has text:', !!json.tweet.text);
    console.log('Has article:', !!json.tweet.article);
    
    if (json.tweet.article) {
      console.log('\n=== Article ===');
      console.log('Title:', json.tweet.article.title);
      console.log('Has content.blocks:', !!json.tweet.article.content?.blocks);
      console.log('Blocks count:', json.tweet.article.content?.blocks?.length);
      
      if (json.tweet.article.content?.blocks) {
        console.log('\n=== Block Types ===');
        json.tweet.article.content.blocks.forEach((block, i) => {
          console.log(`Block ${i}: type=${block.type}, hasText=${!!block.text}, hasEntityRanges=${!!block.entityRanges}`);
        });
        
        console.log('\n=== EntityMap ===');
        console.log(JSON.stringify(json.tweet.article.content.entityMap, null, 2));
      }
      
      console.log('\n=== Media Entities ===');
      console.log('tweet.media_entities:', JSON.stringify(json.tweet.media_entities?.map(e => ({id: e.id, media_id: e.media_id})), null, 2));
      console.log('article.media_entities:', JSON.stringify(json.tweet.article.media_entities?.map(e => ({id: e.id, media_id: e.media_id})), null, 2));
    }
  });
});
req.end();