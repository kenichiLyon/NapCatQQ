import { Entity, PrimaryColumn, Column, Index, CreateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { UserInfo } from "./UserInfo";
import { GroupInfo } from "./GroupInfo";

@Entity()
export class MsgData {
    @PrimaryColumn("varchar", { length: 64 })
    msg_id!: string;

    @Column("varchar", { length: 20 })
    msg_seq!: string;

    @Column("varchar", { length: 20 })
    msg_random!: string;

    @Index()
    @Column("bigint")
    msg_time!: string;

    @Index()
    @Column("varchar", { length: 64 })
    sender_id!: string;

    @Column("varchar", { length: 20 })
    sender_uin!: string;

    @Index()
    @Column("varchar", { length: 64 })
    peer_id!: string;

    @Column("varchar", { length: 20 })
    peer_uin!: string;

    @Column("int")
    chat_type!: number;

    @Column("text")
    content!: string;

    @Column("simple-json")
    raw_elements!: any;

    @CreateDateColumn()
    created_at!: Date;

    @ManyToOne(() => UserInfo, { nullable: true })
    @JoinColumn({ name: "sender_id", referencedColumnName: "user_id" })
    sender!: UserInfo | null;

    @ManyToOne(() => GroupInfo, { nullable: true })
    @JoinColumn({ name: "peer_id", referencedColumnName: "group_id" })
    group!: GroupInfo | null;
}
