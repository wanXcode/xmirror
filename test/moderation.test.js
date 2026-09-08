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
