import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MsgStorageService } from '../src/service/MsgStorageService';

describe('MsgStorageService', () => {
    let service: MsgStorageService;

    beforeEach(() => {
        service = new MsgStorageService();
    });

    it('should fallback to memory when disabled', async () => {
        const msg = { msgId: '1', elements: [] };
        await service.saveMsg(msg);
        expect((service as any).memoryStore.length).toBe(1);
        expect((service as any).memoryStore[0]).toBe(msg);
    });

    it('should extract text content correctly', () => {
        const elements = [
            { textElement: { content: 'Hello' } },
            { faceElement: { faceIndex: 123 } },
            { picElement: {} }
        ];
        const content = (service as any).extractContent(elements);
        expect(content).toBe('Hello[Face:123][Image]');
    });
});
