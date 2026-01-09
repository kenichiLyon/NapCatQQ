import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { MsgData } from './MsgData';

/**
 * 消息原始数据实体
 * 存储压缩后的 raw_elements，与 MsgData 一对一关联
 * 分离存储以减少主表查询时的内存占用
 */
@Entity()
export class MsgBlob {
  /**
   * 消息ID，与 MsgData.msg_id 关联
   */
  @PrimaryColumn('varchar', { length: 64 })
  msg_id!: string;

  /**
   * 与 MsgData 的一对一关系
   * 级联删除：删除消息时自动删除对应的 blob
   */
  @OneToOne(() => MsgData, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'msg_id', referencedColumnName: 'msg_id' })
  msg!: MsgData;

  /**
   * 压缩后的原始消息元素
   * 使用 zlib deflate 压缩的 JSON 数据
   * 存储类型根据数据库自动适配：
   * - SQLite/SQL.js: BLOB
   * - MySQL: LONGBLOB
   * - PostgreSQL: BYTEA
   */
  @Column({ type: 'blob', nullable: false })
  raw_elements!: Buffer;
}
