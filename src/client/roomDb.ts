import Dexie, { Table } from 'dexie';

interface Room {
  id?: string;
  files?: string[];
  key?: string;
  creationTime?: Date;
}

export class RoomDatabase extends Dexie {
  public rooms!: Table<Room, string>;

  public constructor() {
    super('RoomDatabase');
    this.version(1).stores({
      rooms: '&id,creationTime'
    });
  }
}
