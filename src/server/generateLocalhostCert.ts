import path from 'path';
import selfsigned from 'selfsigned';
import fs from 'fs';
import net from 'net';
import { deleteSync } from 'del';


export async function generateCert(hostname: string) {
    const attributes = [{ name: "commonName", value: hostname }];
    const certificateDir = "temp/certs";
    const certificatePath = path.join(certificateDir, "cert.cert");
    const keyPath = path.join(certificateDir, "key.pem");
    let certificateExists = false;

    try {
        const certificate = fs.statSync(certificatePath);
        certificateExists = certificate.isFile();
    } catch {
        certificateExists = false;
    }

    if (certificateExists) {
        const certificateStat = fs.statSync(certificatePath);

        const timeDifference = Math.abs(new Date().getTime() - new Date(certificateStat.ctime).getTime());
        const differentDays = Math.ceil(timeDifference / (1000 * 3600 * 24));
        if (differentDays > 30) {
            console.log("SSL Certificate is more than 30 days old. Removing...");
        }
        deleteSync([certificatePath], { force: true });
        certificateExists = false;
    }

    if (!certificateExists) {
        const pems = selfsigned.generate(attributes, {
            algorithm: "sha256",
            days: 30,
            keySize: 2048,
            extensions: [
                {
                    name: "basicConstraints",
                    cA: true
                },
                {
                    name: "keyUsage",
                    keyCertSign: true,
                    digitalSignature: true,
                    nonRepudiation: true,
                    keyEncipherment: true,
                    dataEncipherment: true
                },
                {
                    name: "extKeyUsage",
                    serverAuth: true,
                    clientAuth: true,
                    codeSigning: true,
                    timeStamping: true
                },
                {
                    name: "subjectAltName",
                    altNames: [
                        net.isIP ?
                        {
                            type: 2,
                            value: hostname
                        }
                        :
                        {
                            type: 7,
                            ip: hostname
                        }
                    ]
                }
            ]
        });

        fs.mkdirSync(certificateDir, { recursive: true });
        fs.writeFileSync(
            certificatePath,
            pems.cert,
            {
                encoding: "utf8"
            }
        );
        fs.writeFileSync(
            keyPath,
            pems.private,
            {
                encoding: "utf8"
            }
        );
    } else {
        console.log("Reusing existing certificate");
    }
}