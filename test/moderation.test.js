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

test('still rejects 高潮 when combined with private-message sales language', () => {
  const moderator = createTestModerator();

  assert.throws(
    () => moderator.moderateArchivedContent({
      url: 'https://x.com/example/status/5',
      authorName: 'example',
      authorHandle: 'example',
      content: '高潮内容请私信我获取购买方式'
    }),
    error => error instanceof ModerationRejectError
  );
});

test('still rejects private-message sales language in either word order', () => {
  const moderator = createTestModerator();

  for (const content of ['私信我获取购买方式', '购买后请私信我']) {
    assert.throws(
      () => moderator.moderateArchivedContent({
        url: 'https://x.com/example/status/4',
        authorName: 'example',
        authorHandle: 'example',
        content
      }),
      error => error instanceof ModerationRejectError
    );
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
