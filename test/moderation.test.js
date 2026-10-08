const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createModerator, ModerationRejectError } = require('../lib/moderation');

function createTestModerator() {
  return createModerator({
    rulesPath: path.join(__dirname, '..', 'config', 'moderation-rules.json'),
    logPath: path.join(os.tmpdir(), `xmirror-moderation-${process.pid}.jsonl`)
  });
}

test('allows ordinary instructions that contain 操作 and 购买', () => {
  const moderator = createTestModerator();
  const result = moderator.moderateArchivedContent({
    url: 'https://x.com/example/status/1',
    authorName: '教程作者',
    authorHandle: 'example',
    content: '按照下面的操作步骤完成域名购买，然后进入控制台检查配置。'
  });

  assert.equal(result.action, 'allow');
  assert.ok(result.score < 6);
  assert.ok(!result.matched.some(match => match.value === '操'));
  assert.ok(!result.matched.some(match => match.value === '露骨内容导流'));
});

test('allows ordinary article language containing 私信, 插, and 摩擦', () => {
  const moderator = createTestModerator();
  const result = moderator.moderateArchivedContent({
    url: 'https://x.com/CopperForgeAI/status/2100104464531394722',
    authorName: '铜匠AI・十点睡觉',
    authorHandle: 'CopperForgeAI',
    content: [
      '三个人试着通过电话和私信联络本地餐饮店主，全部石沉大海。',
      '这只 bot 挂载着 X 的官方 MCP 插件，直播期间还穿插了从业者访谈。',
      '数字极速与物理摩擦的终极对撞。'
    ].join(' ')
  });

  assert.equal(result.action, 'allow');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matched, []);
});

test('allows 高潮 when it describes a narrative climax', () => {
  const moderator = createTestModerator();
  const result = moderator.moderateArchivedContent({
    url: 'https://x.com/CopperForgeAI/status/2100799186086351174',
    authorName: '铜匠AI・十点睡觉',
    authorHandle: 'CopperForgeAI',
    content: '第五幕：终局高潮：在庆功图表前，生产数据库猝死'
  });

  assert.equal(result.action, 'allow');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matched, []);
});

test('allows ordinary technical language containing 露出, 射, 含, 主人, and 刺激', () => {
  const moderator = createTestModerator();
  const result = moderator.moderateArchivedContent({
    url: 'https://x.com/CopperForgeAI/status/2100799186086351174',
    authorName: '铜匠AI・十点睡觉',
    authorHandle: 'CopperForgeAI',
    content: [
      '将 Data Bot 聚合出来的最终业务大盘投射在全场视线焦点。',
      'PR 里面包含了一条很慢的 SQL 查询。',
      '把规则以干净的结构化文档暴露出来，让 Agent 替它们的主人去打排位。',
      '更刺激的是，第一梯队开始向白金段位发起冲击。'
    ].join(' ')
  });

  assert.equal(result.action, 'allow');
  assert.equal(result.score, 0);
  assert.deepEqual(result.matched, []);
});

test('ambiguous promotion signals require context or allow rather than reject', () => {
  const moderator = createTestModerator();
  for (const content of ['私信我获取购买方式', '购买后请私信我', '完整版私信购买', '高潮内容请私信我获取购买方式']) {
    const result = moderator.moderateArchivedContent({ content });
    assert.ok(['allow','review'].includes(result.action));
  }
});

test('still rejects explicit adult content containing 操', () => {
  const moderator = createTestModerator();

  assert.throws(
    () => moderator.moderateArchivedContent({
      url: 'https://x.com/example/status/2',
      authorName: 'example',
      authorHandle: 'example',
      content: '想被我操就私信购买'
    }),
    error => {
      assert.ok(error instanceof ModerationRejectError);
      assert.equal(error.code, 'CONTENT_MODERATION_REJECTED');
      return true;
    }
  );
});

test('still rejects existing explicit adult keywords', () => {
  const moderator = createTestModerator();

  assert.throws(
    () => moderator.moderateArchivedContent({
      url: 'https://x.com/example/status/3',
      authorName: 'example',
      authorHandle: 'example',
      content: '成人视频内容'
    }),
    error => error instanceof ModerationRejectError
  );
});

test('still rejects explicit compound keywords after removing ambiguous stems', () => {
  const moderator = createTestModerator();

  for (const content of ['射精', '性奴', '暴露癖']) {
    assert.throws(
      () => moderator.moderateArchivedContent({
        url: 'https://x.com/example/status/6',
        authorName: 'example',
        authorHandle: 'example',
        content
      }),
      error => error instanceof ModerationRejectError
    );
  }
});

test('allows benign article references to a full version', () => {
  const moderator = createTestModerator();
  const result = moderator.moderateArchivedContent({
    url: 'https://x.com/example/status/4',
    authorName: '产品作者',
    authorHandle: 'example',
    content: '完整版放在文章最后的附录里，供读者继续阅读。'
  });

  assert.equal(result.action, 'allow');
  assert.ok(result.score < 6);
});

test('allows technical words containing English moderation stems', () => {
  const moderator = createTestModerator();
  const result = moderator.moderateArchivedContent({
    url: 'https://x.com/example/status/7',
    authorName: '技术作者',
    authorHandle: 'example',
    content: '这篇 analysis 介绍购买流程，包含 analytics 和 document 示例。'
  });

  assert.equal(result.action, 'allow');
  assert.equal(result.score, 0);
  assert.ok(!result.matched.some(match => match.value === 'anal'));
  assert.ok(!result.matched.some(match => match.value === '英文色情词'));
});

test('isolated English sexual terms are reviewed in context', () => {
  assert.equal(createTestModerator().moderateArchivedContent({content:'explicit anal content'}).action, 'review');
});

for (const [label, payload] of [
  ['Telegram channel', {content:'软件更新通知 https://t.me/product'}],
  ['surname', {authorName:'Sonny Dickson', authorHandle:'gar_goon',content:'New iPhone prototype'}],
  ['government reference', {content:'Privacy news https://gov.uk/nude-images'}],
  ['profanity', {content:'What the fuck happened to my game account?'}],
  ['marketing', {content:'购买软件请联系我，欢迎进群看教学视频'}],
  ['entities', {content:'<p>documentary &amp; analysis</p>'}]
]) test('allows audit regression: '+label, () => assert.equal(createTestModerator().moderateArchivedContent(payload).action,'allow'));

test('AI training ambiguity and explicit adult compound tags enter review', () => {
  for(const content of ['模型被调教成好好先生', '#smalldick #humiliation', '＃sm ＃露出 ＃女仆']) {
    const result=createTestModerator().moderateArchivedContent({content});
    assert.equal(result.action,'review');
    assert.ok(result.matched.every(m=>m.field==='content' && m.evidence));
    assert.equal(result.ruleVersion,7);
  }
});

// Synthetic fixtures: no production identifiers or original post body.
test('rejects explicit sexual compounds, including character substitutions', () => {
  const moderator = createTestModerator();
  for (const content of ['被操射了', '被艹到', '被肏得', '操射出来', '<p>被<b>操</b>射了</p>']) {
    assert.throws(() => moderator.moderateArchivedContent({ content }), error => {
      assert.equal(error.code, 'CONTENT_MODERATION_REJECTED');
      assert.ok(error.details.matched.some(m => m.value === '露骨色情复合表达'));
      return true;
    });
  }
});

test('school, sports, emoji and ordinary operation language alone remain allowed', () => {
  const moderator = createTestModerator();
  for (const content of ['高中同学一起吃饭打游戏 #体育生 #男高', '农场的大🐔发育很好',
    '这个请求被操作系统拒绝了', '比赛射门得分，体操得了冠军', '完成操作到下一步']) {
    assert.equal(moderator.moderateArchivedContent({ content }).action, 'allow');
  }
});

test('operator source ledger blocks URL aliases before fetching and fails closed', t => {
  const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocked-sources-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const blockedSourcesPath = path.join(dir, 'sources.json');
  const moderator = createModerator({ blockedSourcesPath, rulesPath: path.join(__dirname, '../config/moderation-rules.json'), logPath: null });
  assert.equal(moderator.precheckUrl('https://x.com/i/status/81').action, 'allow');
  fs.writeFileSync(blockedSourcesPath, JSON.stringify(['81']));
  for (const url of ['https://x.com/i/status/81', 'https://twitter.com/example/status/81/photo/1', 'https://x.com/i/article/81']) {
    assert.throws(() => moderator.precheckUrl(url), { code: 'CONTENT_MODERATION_REJECTED' });
  }
  assert.equal(moderator.precheckUrl('https://x.com/i/status/810').action, 'allow');
  fs.writeFileSync(blockedSourcesPath, '{}');
  assert.throws(() => moderator.precheckUrl('https://x.com/i/status/82'), /Invalid.*ledger/);
  fs.writeFileSync(blockedSourcesPath, '{');
  assert.throws(() => moderator.precheckUrl('https://x.com/i/status/82'), SyntaxError);
});
