// LinkedIn import: matching, filling blanks only, preview vs apply.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { api, create, useTestServer } from './helpers.ts';

useTestServer();

const row = (o: object) => ({ firstName: '', lastName: '', url: '', email: '', company: '', position: '', connectedOn: null, ...o });
let acme: any, ann: any, bob: any;

beforeEach(async () => {
  acme = await create('/accounts', { name: 'Acme', type: 'Client', aliases: ['Acme Corp'] });
  ann = await create('/contacts', { name: 'Ann Lee', firstName: 'Ann', lastName: 'Lee', title: 'CFO', emails: ['ann@x.com'] });
  bob = await create('/contacts', { name: 'Bob Ray', firstName: 'Bob', lastName: 'Ray', website: 'https://bob.example' });
  await create('/contacts', { name: 'Pat Kim', firstName: 'Pat', lastName: 'Kim' });
  await create('/contacts', { name: 'Pat Kim', firstName: 'Pat', lastName: 'Kim', company: 'Other' });
});

const rows = [
  row({ firstName: 'Ann', lastName: 'Lee', url: 'https://www.linkedin.com/in/annlee', position: 'Chief Financial Officer', company: 'Acme Corp' }),
  row({ firstName: 'Robert', lastName: 'Ray', email: 'BOB@x.com' }), // no match: different name, unknown email
  row({ firstName: 'bob', lastName: 'ray', url: 'https://www.linkedin.com/in/bobray', email: 'bob@x.com', company: 'Beta' }),
  row({ firstName: 'Pat', lastName: 'Kim', url: 'https://www.linkedin.com/in/patkim' }), // two Pat Kims: ambiguous, added
  row({ firstName: 'Cy', lastName: 'Ng', url: 'https://www.linkedin.com/in/cyng', email: 'not-an-email', company: 'ACME', position: 'CTO', connectedOn: '2026-11-02' }),
  row({ url: 'https://www.linkedin.com/in/hidden' }),
];

test('preview changes nothing and matches what import does', async () => {
  const preview = (await api('POST', '/contacts/import/linkedin', { rows })).body.data;
  assert.equal((await api('GET', '/contacts')).body.total, 4, 'preview saved nothing');
  const done = (await api('POST', '/contacts/import/linkedin', { rows, apply: true })).body.data;
  assert.deepEqual({ ...preview, applied: true }, done);
  assert.deepEqual(
    [done.skippedNoName, done.matchedByLink, done.matchedByEmail, done.matchedByName, done.updated, done.added, done.linkedToAccount],
    [1, 0, 0, 2, 2, 3, 2],
  );
  assert.equal((await api('GET', '/contacts')).body.total, 7);
});

test('fills blanks only and tags matches', async () => {
  await api('POST', '/contacts/import/linkedin', { rows, apply: true });
  const a = (await api('GET', `/contacts/${ann.id}`)).body.data;
  assert.equal(a.title, 'CFO', 'existing title kept');
  assert.equal(a.company, 'Acme Corp');
  assert.equal(a.accountId, acme.id, 'linked by alias');
  assert.equal(a.website, 'https://www.linkedin.com/in/annlee');
  assert.deepEqual(a.tags, ['LinkedIn']);
  const b = (await api('GET', `/contacts/${bob.id}`)).body.data;
  assert.equal(b.website, 'https://bob.example', 'existing website kept');
  assert.match(b.notes, /LinkedIn: https:\/\/www\.linkedin\.com\/in\/bobray/);
  assert.deepEqual(b.emails, ['bob@x.com']);
  const cy = (await api('GET', '/contacts?q=Cy Ng')).body.data[0];
  assert.deepEqual([cy.source, cy.dateAdded, cy.accountId, cy.emails, cy.title], ['LinkedIn', '2026-11-02', acme.id, [], 'CTO']);
});

test('running it again changes nothing', async () => {
  await api('POST', '/contacts/import/linkedin', { rows, apply: true });
  const again = (await api('POST', '/contacts/import/linkedin', { rows, apply: true })).body.data;
  assert.deepEqual([again.added, again.updated, again.matchedByLink], [0, 0, 4]);
  assert.equal((await api('GET', '/contacts')).body.total, 7);
});
