const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SEGMENT_SECONDS,
  DEFAULT_TRANSCRIPTION_CONCURRENCY,
  vttTimestamp,
  segmentsToVtt
} = require('../lib/subtitles');

test('incremental subtitle defaults use short bounded segments and concurrency', () => {
  assert.equal(DEFAULT_SEGMENT_SECONDS, 12);
  assert.equal(DEFAULT_TRANSCRIPTION_CONCURRENCY, 3);
});

test('subtitle timestamps use WebVTT hours, milliseconds', () => {
  assert.equal(vttTimestamp(0), '00:00:00.000');
  assert.equal(vttTimestamp(65.432), '00:01:05.432');
  assert.equal(vttTimestamp(3661.5), '01:01:01.500');
});

test('subtitle cues preserve timing and escape cue text', () => {
  const vtt = segmentsToVtt([
    { start: 0, end: 2.5, text: 'Hello <world>' },
    { start: 3, end: 5, text: '下一段\n字幕' }
  ]);
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.match(vtt, /00:00:00\.000 --> 00:00:02\.500/);
  assert.match(vtt, /Hello &lt;world&gt;/);
  assert.match(vtt, /00:00:03\.000 --> 00:00:05\.000/);
  assert.match(vtt, /下一段 字幕/);
});
