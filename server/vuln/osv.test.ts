import assert from "node:assert/strict";
import test from "node:test";
import { cvss3 } from "./osv.js";

// Reference scores from the FIRST CVSS v3.1 calculator.
test("cvss3 matches the reference calculator", () => {
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"), 10);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"), 6.1);
  assert.equal(cvss3("CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N"), 5.5);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N"), 5.9);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0);
  assert.equal(cvss3("CVSS:4.0/AV:N"), undefined);
});
