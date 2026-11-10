import assert from "node:assert/strict";
import test from "node:test";
import { operatorPrint } from "../src/admin/operator-print.js";
import { printPackUpload } from "../src/album/print-upload.js";

const booking = (id) => ({ _id: id, accessToken: "test-album", printSize: "strip" });
const images = [new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })];
const storage = () => { const values = new Map(); return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; };

test("binary print upload accepts original Blobs without re-encoding", async () => {
  const upload = printPackUpload({ images, frameName: "Pink", requestKey: "key" });
  assert.equal(upload.headers["X-Print-Sheets"], "3");
  assert.deepEqual([...new Uint8Array(await upload.body.arrayBuffer())], [1, 2, 3]);
});

test("RX1 reprints send each saved sheet the requested number of times and archive without queue delivery", async () => {
  let local, archived;
  await operatorPrint({ booking: booking("copies"), images, copies: 3, sourceJob: { _id: "source" } }, {
    storage: storage(), send: async (job) => { local = job; }, request: async (path, options) => { archived = { path, ...options }; return { _id: "saved" }; },
  });
  assert.equal(local.images.length, 3);
  assert.equal(local.images[0], images[0]);
  assert.equal(archived.body.delivery, "local");
  assert.equal(archived.body.requestKey, local.requestKey);
  assert.equal(archived.body.copies, 3);
});

test("lost archive response retries the record only, without sending a second physical print", async () => {
  const job = { booking: booking("lost-archive"), images, frameName: "Pink" };
  const store = storage();
  let sends = 0, calls = 0;
  const keys = [];
  const dependencies = { storage: store, send: async () => { sends++; }, request: async (_path, upload) => {
    keys.push(upload.headers["X-Print-Key"]);
    if (++calls === 1) throw new Error("Reply lost");
    return { _id: "saved" };
  } };
  await assert.rejects(operatorPrint(job, dependencies), (error) => error.printed && /không được in thêm/.test(error.message));
  await operatorPrint(job, dependencies);
  assert.equal(sends, 1);
  assert.equal(keys[0], keys[1]);
});

test("uncertain local acknowledgement keeps the same durable print ID on manual retry", async () => {
  const job = { booking: booking("lost-local"), images, sourceJob: { _id: "source" } };
  const keys = [];
  let archived = 0;
  const dependencies = { storage: storage(), send: async (request) => {
    keys.push(request.requestKey);
    if (keys.length === 1) throw new Error("Check printer before retrying");
  }, request: async () => { archived++; return {}; } };
  await assert.rejects(operatorPrint(job, dependencies), /Check printer/);
  assert.equal(archived, 0);
  await operatorPrint(job, dependencies);
  assert.equal(keys[0], keys[1]);
  assert.equal(archived, 1);
});

test("unsupported paper and excessive copies fail before local output or archive writes", async () => {
  const dependencies = { send: async () => { throw new Error("Should not print"); } };
  await assert.rejects(operatorPrint({ booking: booking("instax"), images, printSize: "instax" }, dependencies), /Instax/);
  await assert.rejects(operatorPrint({ booking: booking("limit"), images: [...images, ...images], copies: 11 }, dependencies), /20 tờ/);
});
