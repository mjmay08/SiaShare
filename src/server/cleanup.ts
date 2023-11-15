import { Metadata } from "./metadata";
import { SiaService } from "./sia-service";
import { TusServer } from "./tus-server";

export function cleanup(metadata: Metadata, tusServer: TusServer, siaService: SiaService): void {
    console.log("Clean up initiated");
    // Query all rooms that are expired
    metadata.getExpiredRooms().then((expiredRooms) => {
        if (expiredRooms.length < 1) {
            console.log("Nothing to clean up");
            return;
        }
        console.log(`Found ${expiredRooms.length} rooms to clean up. Removing...`);
        for (const room of expiredRooms) {
            cleanupFilesForRoom(metadata, tusServer, siaService, room.id).then((success) => {
                if (success) {
                    metadata.deleteRoomById(room.id);
                }
            });
        }
    });
    

    // TODO FUTURE: Remove files from temp folder after some time limit? Or size limit? Would have to verify they are uploaded to Sia successfully first.
}

/**
 * This will perform the following actions for the given room:
 * -Remove files from temp cache directory.
 * -Remove files from Sia network.
 * -Remove file records from db.
 */
function cleanupFilesForRoom(metadata: Metadata, tusServer: TusServer, siaService: SiaService, roomId: string): Promise<boolean> {
    console.log(`Removing files for room ${roomId}`);
    return metadata.getAllFilesForRoom(roomId).then((files) => {
        for (const file of files) {
            tusServer.deleteFileIfExists(file.tusId);
        }

        // Remove entire room from Sia all at once
        return siaService.deleteRoom(roomId).then((successfullyDeleted) => {
            if (successfullyDeleted) {
                console.log('Successfully deleted room from sia');
                // Files have been removed from filesystem cache (if present) and the entire room has been successfully removed from Sia network.
                // We can clean up the entries in the db
                metadata.deleteAllFilesForRoom(roomId);
                return true;
            } else {
                console.log('Failed to delete from Sia');
                // Don't remove the files from the db. Will leave them so we can try again later.
                return false;
            }
        });
    });
}