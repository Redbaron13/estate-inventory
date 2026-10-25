import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pagesTarget } from '../scripts/pages-target.mjs';

test('Pages custom domains use HTTPS and root assets', () => {
  assert.deepEqual(pagesTarget({ cname: 'eiapp3.redbaronworks.com', html_url: 'http://eiapp3.redbaronworks.com/' }), { site: 'https://eiapp3.redbaronworks.com/', base: '/' });
});
test('Pages project URLs retain their asset path', () => {
  assert.deepEqual(pagesTarget({ cname: null, html_url: 'https://redbaron13.github.io/estate-inventory/' }), { site: 'https://redbaron13.github.io/estate-inventory/', base: '/estate-inventory/' });
});
test('invalid Pages metadata cannot inject workflow settings', () => {
  for (const cname of ['user@example.com', 'example.com/path', 'example.com?query', 'example.com:123', 'example.com\nOTHER=value']) assert.throws(() => pagesTarget({ cname }));
  assert.throws(() => pagesTarget({ html_url: 'https://unrelated.example/' }));
});
