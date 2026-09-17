const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveMediaAssetPath,
  deleteMediaAsset,
  deleteMediaAssetBestEffort
} = require('../lib/media-assets');

test('media paths resolve inside custom DATA_DIR image and video directories', () => {
  const dataDir = path.join(os.tmpdir(), 'xmirror-data');

  assert.equal(
    resolveMediaAssetPath(dataDir, '/images/post_1.jpg'),
    path.resolve(dataDir, 'images', 'post_1.jpg')
  );
  assert.equal(
    resolveMediaAssetPath(dataDir, '/videos/post_1.mp4'),
    path.resolve(dataDir, 'videos', 'post_1.mp4')
  );
});

test('media paths reject traversal, nested paths, and unsupported locations', () => {
  const dataDir = path.join(os.tmpdir(), 'xmirror-data');
  const invalidPaths = [
    '/images/../outside.txt',
    '/images/%2e%2e%2foutside.txt',
    '/videos/nested/clip.mp4',
    '/images/..\\outside.txt',
    '/avatars/user.png',
    'images/photo.jpg',
    '/images/photo.jpg?cache=1',
    '/images/%E0%A4%A'
  ];

  for (const invalidPath of invalidPaths) {
    assert.equal(resolveMediaAssetPath(dataDir, invalidPath), null, invalidPath);
  }
});

test('deleteMediaAsset deletes allowed DATA_DIR media without touching outside files', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xmirror-media-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const dataDir = path.join(tempDir, 'persistent-data');
  const imageDir = path.join(dataDir, 'images');
  const videoDir = path.join(dataDir, 'videos');
  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(videoDir, { recursive: true });

  const imagePath = path.join(imageDir, 'post.jpg');
  const videoPath = path.join(videoDir, 'post.mp4');
  const outsidePath = path.join(tempDir, 'outside.txt');
  fs.writeFileSync(imagePath, 'image');
  fs.writeFileSync(videoPath, 'video');
  fs.writeFileSync(outsidePath, 'keep');

  assert.equal(deleteMediaAsset(dataDir, '/images/post.jpg'), true);
  assert.equal(deleteMediaAsset(dataDir, '/videos/post.mp4'), true);
  assert.equal(deleteMediaAsset(dataDir, '/images/../outside.txt'), false);

  assert.equal(fs.existsSync(imagePath), false);
  assert.equal(fs.existsSync(videoPath), false);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'keep');
});

test('deleteMediaAsset safely ignores missing and invalid values', () => {
  assert.equal(deleteMediaAsset('/tmp/xmirror-data', '/images/missing.jpg'), false);
  assert.equal(deleteMediaAsset('/tmp/xmirror-data', undefined), false);
});

test('deleteMediaAsset propagates an unlink failure to its caller', () => {
  const ioError = new Error('permission denied');
  const failingFs = {
    existsSync: () => true,
    unlinkSync: () => { throw ioError; }
  };

  assert.throws(
    () => deleteMediaAsset('/tmp/xmirror-data', '/images/post.jpg', failingFs),
    ioError
  );
});

test('best-effort media cleanup reports an unlink failure without throwing', () => {
  const warnings = [];
  const failingFs = {
    existsSync: () => true,
    unlinkSync: () => { throw new Error('permission denied'); }
  };

  assert.equal(
    deleteMediaAssetBestEffort(
      '/tmp/xmirror-data',
      '/images/post.jpg',
      failingFs,
      (...args) => warnings.push(args)
    ),
    false
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].join(' '), /permission denied/);
});
