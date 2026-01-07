import "reflect-metadata";
import { describe, it, expect, beforeAll } from "vitest";
import { MsgStorageService } from "../src/service/MsgStorageService";

const svc = new MsgStorageService();

describe("MsgStorageService Query", () => {
  beforeAll(async () => {
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

  it("bulk save fallback memory", async () => {
    const msgs = Array.from({ length: 3 }).map((_, i) => ({
      msgId: `id${i}`,
      msgSeq: `${i}`,
      msgRandom: `${i}`,
      msgTime: `${Date.now()}`,
      senderUid: `u${i}`,
      senderUin: `${10000 + i}`,
      peerUid: `p${i}`,
      peerUin: `${20000 + i}`,
      chatType: 1,
      elements: [{ textElement: { content: `hello ${i}` } }]
    }));
    await svc.saveMsgsBulk(msgs as any[]);
    expect((svc as any).memoryStore.length).toBeGreaterThanOrEqual(3);
  });

  it("query default pagination", async () => {
    const res = await svc.queryMsg({ page: 1, pageSize: 50 });
    expect(res.pageSize).toBe(50);
  });
});
