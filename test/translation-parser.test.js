const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { TranslationFormatError } = require('../lib/translation');

// Exercise the actual server parser without starting HTTP or opening runtime data.
function parser(content) {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const code = source.slice(source.indexOf('async function translateWithSiliconFlow('), source.indexOf('const SUBTITLE_LANGUAGES'));
  const context = vm.createContext({
    SILICONFLOW_API_KEY: 'test', SILICONFLOW_MODEL: 'test', SILICONFLOW_FALLBACK_MODELS: [], SILICONFLOW_BASE_URL: 'test',
    TranslationFormatError,
    createChatCompletion: async () => ({ json: { choices: [{ message: { content } }] } })
  });
  vm.runInContext(code, context);
  return parts => context.translateWithSiliconFlow(parts, 'zh-CN');
}

test('parser rejects JSON fragments even when line count matches the input', async () => {
  await assert.rejects(parser('{"parts":["译文",\n]\n}')(['a', 'b', 'c']));
  await assert.rejects(parser(JSON.stringify({parts:['{"task":"翻译数组"', ']', '}']}))(['a', 'b', 'c']), /格式异常/);
});

test('parser accepts a valid structured translation', async () => {
  const result = await parser('{"parts":["你好","世界"]}')(['hello', 'world']);
  assert.equal(result.translations.join('|'), '你好|世界');
});
