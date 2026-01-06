import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity()
export class GroupInfo {
    @PrimaryColumn("varchar", { length: 64 })
    group_id!: string; // groupCode

    @Column("varchar", { length: 255 })
    group_name!: string;

    @Column("datetime", { nullable: true })
    last_updated!: Date;
}
