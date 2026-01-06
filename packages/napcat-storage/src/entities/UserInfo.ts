import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity()
export class UserInfo {
    @PrimaryColumn("varchar", { length: 64 })
    user_id!: string; // uid

    @Column("varchar", { length: 20 })
    uin!: string;

    @Column("varchar", { length: 255 })
    username!: string; // nick

    @Column("text", { nullable: true })
    avatar!: string;

    @Column("datetime", { nullable: true })
    last_updated!: Date;
}
