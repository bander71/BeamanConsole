// Contact imports (LinkedIn, Outlook): matching, filling blanks only, preview vs apply.

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
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
    [done.skipped[0].count, done.matchedByLink, done.matchedByEmail, done.matchedByName, done.updated, done.added, done.linkedToAccount],
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

describe('Outlook', () => {
  const o = (x: object) => ({ name: '', emails: [], company: '', title: '', mobile: '', businessPhone: '', homePhone: '', signaturePhones: '', ...x });
  let acmeCo: any;
  beforeEach(async () => {
    acmeCo = await create('/contacts', { name: 'Dee Fox', firstName: 'Dee', lastName: 'Fox', emails: ['dee@acme.com'], accountId: acme.id });
    // Most acme.com contacts are at Acme; one consultant with an old acme.com address is at another account.
    const other = await create('/accounts', { name: 'Other Co' });
    await create('/contacts', { name: 'Eve Oak', emails: ['eve@acme.com'], accountId: acme.id });
    await create('/contacts', { name: 'Fay Ash', emails: ['fay@acme.com'], accountId: acme.id });
    await create('/contacts', { name: 'Hal Yew', emails: ['hal@acme.com', 'hal@other.co'], accountId: other.id });
    await create('/employees', { firstName: 'Brad', lastName: 'Anderson', email: 'brad@beaman.com' });
  });
  const rows = [
    o({ name: 'Ann Lee', emails: ['ann@x.com', 'ann@other.com'], mobile: '555-0100' }), // matched by email, gets the new address
    o({ name: 'Ann Lee', emails: ['ann.lee@gmail.com'] }), // same person, joined
    o({ name: 'Gus Hart', emails: ['gus@acme.com'], signaturePhones: 'Work: 785.266.4870; Direct: 785.267.9013' }), // new, linked to Acme by domain
    o({ name: 'Ivy Moss', emails: ['ivy@gmail.com'], company: 'Acme Corp', title: 'COO' }), // new, linked by company
    o({ name: 'Acme Billing', emails: ['billing@acme.com'] }), // shared inbox
    o({ name: 'Vercel', emails: ['notifications@vercel.com'] }), // automated
    o({ name: 'Brad Anderson via Smartsheet', emails: ['automation@app.smartsheet.com'] }), // automated
    o({ name: 'Brad Anderson', emails: ['brad.anderson@hodgdon.com'] }), // an employee's name
    o({ emails: ['me@mine.com'] }), // one of my mailboxes
    o({ emails: ['solo@zed.com'] }), // no name: added under its address
  ];

  test('skips own and automated rows, joins names, links accounts', async () => {
    const preview = (await api('POST', '/contacts/import/outlook', { rows, ownEmails: ['ME@mine.com'] })).body.data;
    const done = (await api('POST', '/contacts/import/outlook', { rows, ownEmails: ['ME@mine.com'], apply: true })).body.data;
    assert.deepEqual({ ...preview, applied: true }, done);
    assert.deepEqual(Object.fromEntries(done.skipped.map((s: any) => [s.reason, s.count])), { 'automated sender or shared inbox': 3, 'your own address': 2 });
    assert.deepEqual([done.matchedByEmail, done.updated, done.added, done.linkedToAccount], [1, 1, 3, 2]);

    const a = (await api('GET', `/contacts/${ann.id}`)).body.data;
    assert.deepEqual(a.emails, ['ann@x.com', 'ann@other.com', 'ann.lee@gmail.com']);
    assert.equal(a.mobile, '555-0100');
    assert.equal(a.title, 'CFO', 'existing title kept');
    assert.deepEqual(a.tags, ['Outlook']);
    const gus = (await api('GET', '/contacts?q=Gus Hart')).body.data[0];
    assert.deepEqual([gus.accountId, gus.company, gus.businessPhone, gus.source], [acme.id, 'Acme', '785.267.9013', 'Outlook']);
    assert.match(gus.notes, /Work: 785\.266\.4870/);
    const ivy = (await api('GET', '/contacts?q=Ivy Moss')).body.data[0];
    assert.deepEqual([ivy.accountId, ivy.title], [acme.id, 'COO']);
    assert.equal((await api('GET', '/contacts?q=solo@zed.com')).body.data[0].name, 'solo@zed.com');
    assert.equal(acmeCo.accountId, acme.id);
  });

  test('can include automated senders, and running again changes nothing', async () => {
    const r = (await api('POST', '/contacts/import/outlook', { rows, includeAutomated: true })).body.data;
    assert.equal(r.added, 7, 'Acme Billing, Vercel and the Smartsheet sender are added too');
    await api('POST', '/contacts/import/outlook', { rows, apply: true });
    const again = (await api('POST', '/contacts/import/outlook', { rows, apply: true })).body.data;
    assert.deepEqual([again.added, again.updated], [0, 0]);
  });
});
