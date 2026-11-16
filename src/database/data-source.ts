import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm.config';

/** Dipakai oleh TypeORM CLI (migration:generate / run / revert). */
export default new DataSource(buildDataSourceOptions(process.env));
