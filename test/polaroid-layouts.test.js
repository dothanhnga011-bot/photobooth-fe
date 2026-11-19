import assert from "node:assert/strict";
import test from "node:test";
import { polaroidPackage } from "../src/polaroid-layouts.js";

test("Selfbooth packages are timed like the Selfbooth site: unlimited shots, the package's minutes, prints and price stay", () => {
  const old = { name: "Chụp đôi", printSize: "large", selectCount: 2, duration: 12, shots: 8, prints: 2, price: 150000 };
  const normalized = polaroidPackage(old);
  assert.deepEqual([normalized.duration, normalized.prints, normalized.price, normalized.shots], [12, 2, 150000, 0]);
  assert.equal(old.shots, 8, "does not mutate the input");
  const booth = { printSize: "full", selectCount: 4, duration: 15, shots: 12 };
  assert.equal(polaroidPackage(booth), booth);
});
