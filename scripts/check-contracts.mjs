import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
for (const file of ['package.json', 'tsconfig.base.json', 'packages/contracts/package.json', 'packages/contracts/tsconfig.json']) {
  JSON.parse(readFileSync(file, 'utf8'));
}
const dto = readFileSync('packages/contracts/src/index.ts', 'utf8');
const api = readFileSync('docs/http-api.md', 'utf8');
for (const name of ['ProductInput', 'Product', 'AdminAction', 'Proposal', 'ConfirmInput', 'OrderInput', 'Order', 'Payment', 'MessageInput', 'MessageResult', 'SocialDraft', 'ApiError']) {
  assert.match(dto, new RegExp(`export (interface|type) ${name}\\b`));
  assert.ok(api.includes(name), `${name} falta en contrato HTTP`);
}
assert.match(readFileSync('pnpm-workspace.yaml', 'utf8'), /packages\/\*/);
console.log('Base JSON, workspace y referencias HTTP/DTO coherentes. No valida lógica de aplicación.');
