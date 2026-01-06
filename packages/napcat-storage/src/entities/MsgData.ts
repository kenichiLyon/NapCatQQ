import { Entity, PrimaryColumn, Column, Index, CreateDateColumn } from "typeorm";

@Entity()
export class MsgData {
    @PrimaryColumn("varchar", { length: 64 })
    msg_id!: string;

    @Column("varchar", { length: 20 })
    msg_seq!: string;

    @Column("varchar", { length: 20 })
    msg_random!: string;

    @Index()
    @Column("varchar", { length: 20 })
    msg_time!: string; // Timestamp from msg

    @Index()
    @Column("varchar", { length: 64 })
    sender_id!: string; // senderUid

    @Column("varchar", { length: 20 })
    sender_uin!: string;

    @Index()
    @Column("varchar", { length: 64 })
    peer_id!: string; // peerUid

    @Column("varchar", { length: 20 })
    peer_uin!: string;

    @Column("int")
    chat_type!: number;

    @Column("text")
    content!: string; // Human readable content for search

    @Column("simple-json")
    raw_elements!: any; // The elements array

    @CreateDateColumn()
    created_at!: Date;
}
