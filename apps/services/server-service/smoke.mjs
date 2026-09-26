// End-to-end smoke for channel categories and the layout endpoint:
// create/rename/delete, filing channels, reordering, visibility and access.
const AUTH = process.env.AUTH_URL ?? 'http://127.0.0.1:3001';
const SERVER = process.env.SERVER_URL ?? 'http://127.0.0.1:3003';

const json = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

/** The status code alone, for the cases where the refusal is the point. */
const statusOf = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  return response.status;
};

/** A false assertion fails the run: this script is the CI integration test. */
const ok = (label, condition, detail = '') => {
  if (!condition) {
    console.error(`FAIL ${label} ${detail}`);
    process.exit(1);
  }
  console.log(`${label} ok`, detail);
};

const suffix = Date.now().toString(36);
const register = async (tag) => {
  const auth = await json(`${AUTH}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email: `smoke-cat-${tag}-${suffix}@betweenus.local`,
      username: `smokecat${tag}${suffix}`,
      password: 'hunter2000',
    }),
  });
  return { id: auth.user.id, username: auth.user.username, headers: { Authorization: `Bearer ${auth.accessToken}` } };
};

const owner = await register('o');
const admin = await register('a');
const outsider = await register('x');

const api = `${SERVER}/api/v1`;
const server = await json(`${api}/servers`, {
  method: 'POST',
  headers: owner.headers,
  body: JSON.stringify({ name: `Cat ${suffix}` }),
});
const sid = server.id;

// --- Categories: name normalisation ------------------------------------------
const post = (name, headers = owner.headers) =>
  json(`${api}/servers/${sid}/categories`, { method: 'POST', headers, body: JSON.stringify({ name }) });

const trimmed = await post('  Team   Chat \t Zone  ');
ok('name trimmed and collapsed', trimmed.name === 'Team Chat Zone', trimmed.name);
const capped = await post('x'.repeat(64));
ok('64 characters kept', capped.name.length === 64);
const blank = await post('     ');
ok('blank becomes the default', blank.name === 'Category', blank.name);

const list = await json(`${api}/servers/${sid}/categories`, { headers: owner.headers });
ok('three categories listed in creation order', list.map((c) => c.id).join() === [trimmed, capped, blank].map((c) => c.id).join());

// --- A channel created into a category ---------------------------------------
const filed = await json(`${api}/channels`, {
  method: 'POST',
  headers: owner.headers,
  body: JSON.stringify({ serverId: sid, name: 'filed', categoryId: trimmed.id }),
});
ok('channel created into a category', filed.categoryId === trimmed.id);
const loose = await json(`${api}/channels`, {
  method: 'POST',
  headers: owner.headers,
  body: JSON.stringify({ serverId: sid, name: 'loose' }),
});
ok('channel created without one is uncategorized', !loose.categoryId);

// --- Rename ------------------------------------------------------------------
const renamed = await json(`${api}/servers/${sid}/categories/${blank.id}`, {
  method: 'PATCH',
  headers: owner.headers,
  body: JSON.stringify({ name: '  Renamed  ' }),
});
ok('rename normalises too', renamed.name === 'Renamed', renamed.name);

// --- Layout: categories, then channels between categories --------------------
const layout = (body, headers = owner.headers) =>
  fetch(`${api}/servers/${sid}/channel-layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

let response = await layout({ categoryIds: [blank.id, capped.id, trimmed.id] });
ok('reorder categories accepted', response.ok, String(response.status));
const reordered = await json(`${api}/servers/${sid}/categories`, { headers: owner.headers });
ok(
  'categories come back in the new order',
  reordered.map((c) => c.id).join() === [blank.id, capped.id, trimmed.id].join(),
);

response = await layout({
  channels: [
    { id: loose.id, categoryId: capped.id },
    { id: filed.id, categoryId: capped.id },
  ],
});
ok('channels move between categories', response.ok, String(response.status));
const moved = await json(`${api}/channels?serverId=${sid}`, { headers: owner.headers });
const at = (id) => moved.find((channel) => channel.id === id);
ok('both channels now filed under the second category', at(loose.id).categoryId === capped.id && at(filed.id).categoryId === capped.id);
ok('order inside the category follows the request', at(loose.id).position < at(filed.id).position);

// An unknown category or a duplicated id is refused.
response = await layout({ channels: [{ id: loose.id, categoryId: '00000000-0000-4000-8000-000000000000' }] });
ok('unknown category refused', response.status === 404, String(response.status));
response = await layout({ categoryIds: [capped.id, capped.id] });
ok('duplicate category refused', response.status === 400 || response.status === 422, String(response.status));

// --- A channel the caller cannot see is refused -------------------------------
const invite = await json(`${api}/servers/${sid}/invites`, {
  method: 'POST',
  headers: owner.headers,
  body: JSON.stringify({}),
});
await json(`${api}/servers/join`, {
  method: 'POST',
  headers: admin.headers,
  body: JSON.stringify({ code: invite.code }),
});
await json(`${api}/servers/${sid}/members/${admin.id}`, {
  method: 'PATCH',
  headers: owner.headers,
  body: JSON.stringify({ role: 'ADMIN' }),
});
const secret = await json(`${api}/channels`, {
  method: 'POST',
  headers: owner.headers,
  body: JSON.stringify({ serverId: sid, name: 'secret', isPrivate: true }),
});
const seen = await json(`${api}/channels?serverId=${sid}`, { headers: admin.headers });
ok('the admin cannot see the private channel', !seen.some((channel) => channel.id === secret.id));
response = await layout({ channels: [{ id: secret.id, categoryId: null }] }, admin.headers);
ok('layout naming an unseen channel refused', response.status === 404, String(response.status));
response = await layout({ categoryIds: [capped.id, blank.id, trimmed.id] }, admin.headers);
ok('the same admin can still send a layout that names only what they see', response.ok, String(response.status));

// --- Delete keeps the channels ------------------------------------------------
const gone = await statusOf(`${api}/servers/${sid}/categories/${capped.id}`, {
  method: 'DELETE',
  headers: owner.headers,
});
ok('delete category', gone === 204, String(gone));
const after = await json(`${api}/channels?serverId=${sid}`, { headers: owner.headers });
ok(
  'its channels survive, uncategorized',
  [loose.id, filed.id].every((id) => after.some((channel) => channel.id === id && !channel.categoryId)),
);

// --- A non-member is refused everywhere ---------------------------------------
const denied = [
  await statusOf(`${api}/servers/${sid}/categories`, { headers: outsider.headers }),
  await statusOf(`${api}/servers/${sid}/categories`, { method: 'POST', headers: outsider.headers, body: JSON.stringify({ name: 'x' }) }),
  await statusOf(`${api}/servers/${sid}/categories/${blank.id}`, { method: 'PATCH', headers: outsider.headers, body: JSON.stringify({ name: 'x' }) }),
  await statusOf(`${api}/servers/${sid}/categories/${blank.id}`, { method: 'DELETE', headers: outsider.headers }),
  (await layout({ categoryIds: [blank.id] }, outsider.headers)).status,
];
ok('non-member refused on every route', denied.every((code) => code === 403 || code === 404), denied.join());

console.log('server-service smoke passed');
