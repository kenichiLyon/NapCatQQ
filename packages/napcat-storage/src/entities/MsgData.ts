import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UserInfo } from './UserInfo';
import { GroupInfo } from './GroupInfo';

/**
 * 消息数据实体（轻量化版本）
 * raw_elements 已分离到 MsgBlob 表
 * 添加整型主键 id 用于 FTS5 全文搜索的 content_rowid
 */
@Entity()
export class MsgData {
  /**
   * 自增整型主键，用于 FTS5 content_rowid 绑定
   */
  @PrimaryGeneratedColumn('increment')
  id!: number;

  /**
   * 消息唯一标识符（业务主键）
   */
  @Index({ unique: true })
  @Column('varchar', { length: 64 })
  msg_id!: string;

  @Column('varchar', { length: 20 })
  msg_seq!: string;

  @Column('varchar', { length: 20 })
  msg_random!: string;

  @Index()
  @Column('bigint')
  msg_time!: string;

  @Index()
  @Column('varchar', { length: 64 })
  sender_id!: string;

  @Column('varchar', { length: 20 })
  sender_uin!: string;

  @Index()
  @Column('varchar', { length: 64 })
  peer_id!: string;

  @Column('varchar', { length: 20 })
  peer_uin!: string;

  @Column('int')
  chat_type!: number;

  /**
   * 提取的纯文本内容，用于全文搜索
   */
  @Column('text')
  content!: string;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => UserInfo, { nullable: true })
  @JoinColumn({ name: 'sender_id', referencedColumnName: 'user_id' })
  sender!: UserInfo | null;

  @ManyToOne(() => GroupInfo, { nullable: true })
  @JoinColumn({ name: 'peer_id', referencedColumnName: 'group_id' })
  group!: GroupInfo | null;
}

/**
 * 轻量消息数据接口
 * 用于 LRU 缓存，不包含 raw_elements
 */
export interface MsgDataLight {
  id?: number;
  msg_id: string;
  msg_seq: string;
  msg_random: string;
  msg_time: string;
  sender_id: string;
  sender_uin: string;
  peer_id: string;
  peer_uin: string;
  chat_type: number;
  content: string;
  created_at?: Date;
}

/**
 * 完整消息数据接口（包含 raw_elements）
 * 用于查询返回和外部接口
 */
export interface MsgDataFull extends MsgDataLight {
  raw_elements: any;
}
