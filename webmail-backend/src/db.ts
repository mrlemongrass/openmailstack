import mysql from 'mysql2/promise';
import { dbConfig } from './config';

export const pool = mysql.createPool(dbConfig);
