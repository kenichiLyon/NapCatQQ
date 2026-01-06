import { Entity, PrimaryColumn, Column, CreateDateColumn } from "typeorm";

@Entity()
export class DbVersion {
    @PrimaryColumn("varchar", { length: 20 })
    version!: string;

    @Column("text", { nullable: true })
    description!: string;

    @CreateDateColumn()
    applied_at!: Date;
}
