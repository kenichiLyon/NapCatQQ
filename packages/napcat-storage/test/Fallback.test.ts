import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MsgStorageService } from "../src/service/MsgStorageService";
import fs from "node:fs/promises";
import path from "node:path";

const tmpDir = path.join(process.cwd(), "tmp_test_storage");
const workdir = tmpDir;
const svc = new MsgStorageService();

describe("MsgStorageService Fallback", () => {
  beforeAll(async () => {
    process.env.NAPCAT_WORKDIR = workdir;
    await fs.mkdir(workdir, { recursive: true });
    await svc.init({
      enable: false,
      type: "mysql",
      host: "",
      port: 0,
      username: "",
      password: "",
      database: "",
      redisHost: "",
      redisPort: 0,
      redisPassword: ""
    });
  });

  afterAll(async () => {
    try {
      await fs.rm(workdir, { recursive: true, force: true });
    } catch {}
  });

  it("appends messages to JSONL fallback file", async () => {
    const msgs = Array.from({ length: 2 }).map((_, i) => ({
      msgId: `fid${i}`,
      msgSeq: `${i}`,
      msgRandom: `${i}`,
      msgTime: `${Date.now()}`,
      senderUid: `u${i}`,
      senderUin: `${10000 + i}`,
      peerUid: `p${i}`,
      peerUin: `${20000 + i}`,
      chatType: 1,
      elements: [{ textElement: { content: `fallback ${i}` } }]
    }));
    for (const m of msgs) await svc.saveMsg(m as any);
    const file = path.join(workdir, "storage", "msg_fallback.jsonl");
    const content = await fs.readFile(file, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const obj = JSON.parse(lines[0]);
    expect(obj.msgId).toBeDefined();
  });
});
