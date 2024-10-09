import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { fileURLToPath }from 'url';

import {
    GetObjectCommand,
    S3Client, PutObjectCommand
  } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
  

const s3Client = new S3Client({ region: process.env.REGION });

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html 
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 * 
 */

export const lambdaHandler = async (event, context) => {
    try {

        const DELTABUCKET =  "cdn-xsalesconsumer" //process.env.DELTABUCKET_BUCKET_NAME;

        // const browser = await puppeteer.launch({
        //     args: chromium.args,
        //     defaultViewport: chromium.defaultViewport,
        //     executablePath: await chromium.executablePath(),
        //     headless: chromium.headless,
        // });

        

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        console.log("Loading template");
        const file = fs.readFileSync(path.resolve(__dirname, 'template.hbs'), 'utf8')
    
        const template = handlebars.compile(file)
        
        const content = template()
        console.log("template", content);

        
        console.log("Using remote Chromium");
        // const browser = await puppeteer.launch({
        //     args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
        //     defaultViewport: chromium.defaultViewport,
        //     executablePath: await chromium.executablePath()
        //         //"https://github.com/Sparticuz/chromium/releases/download/v110.0.1/chromium-v110.0.1-pack.tar"
        //     ,
        //     headless: chromium.headless,
        //     ignoreHTTPSErrors: true,
        // });
        
        const IS_LOCAL = process.env.IS_LOCAL === 'true' ? true : false
        const localChromiumPath = "/tmp/localChromium/chromium/linux-1365805/chrome-linux/chrome"
        
        let browser;

        if (IS_LOCAL) {
            console.log("Using local chromium");
            // Directly use the local path for Chromium
            browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'], // Common args
                executablePath: localChromiumPath, // Path to local Chromium
                headless: true, // Typically true for automated tasks
                ignoreHTTPSErrors: true,
            });
        }
        else {
            console.log("Using remote chromium");
            browser = await puppeteer.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        }
        // const browser = await puppeteer.launch({
        //     args: IS_LOCAL ? puppeteer.defaultArgs() : chromium.args,
        //     defaultViewport: chromium.defaultViewport,
        //     executablePath: IS_LOCAL
        //       ? "/tmp/localChromium/chromium/linux-1365805/chrome-linux/chrome"
        //       : await chromium.executablePath(),
        //     headless: IS_LOCAL ? false : chromium.headless,
        // });
        
          const page = await browser.newPage();
        
          await page.setContent(content);
        await page.emulateMediaType("screen");

        //const buffer = await page.pdf({ format: "A4" });
        const buffer = await page.pdf({
            path: '/tmp/pdfReport.pdf', // TAKE ATTENTION!!
            format: 'A4',
            printBackground: true,
            margin: { top: 20, left: 20, right: 20, bottom: 20 },
            displayHeaderFooter: true
        })

        await page.close();
        await browser?.close();
        console.log("PDF generation finished");

        // Guardar el PDF en el sistema de archivos temporal (/tmp)
        const pdfPath = `/tmp/generated.pdf`;
        fs.writeFileSync(pdfPath, buffer); // Guardar el archivo en /tmp
        console.log(`PDF generado y guardado en ${pdfPath}`);
        
        // Leer el archivo de /tmp para verificar que se guardó correctamente
        const savedBuffer = fs.readFileSync(pdfPath);
        console.log("Tamaño del PDF guardado:", savedBuffer.length);

                // Codificar el buffer del PDF en base64 para enviarlo en la respuesta
        const pdfBase64 = savedBuffer.toString('base64');
        
        // convertir el buffer a base64

        //retornar el buffer como pdf
        // return {
        //     'statusCode': 200,
        //     'body': JSON.stringify({
        //         result: 'success', buffer
        //     })
        // }
        
        //const s3Key = `${new Date().toISOString()}.pdf`

        //const pdfBase64 = buffer.toString('base64');



            
         const s3Key = `tmp/${new Date().toISOString()}.pdf`;

            // Subir el archivo comprimido a S3
        const command = new PutObjectCommand({
            Bucket: DELTABUCKET,
            Key: s3Key,
            Body: buffer,
            ContentType: "application/pdf",
        });
            

        try {
            await s3Client.send(command);
            console.log("file uploaded:", s3Key);
            //resolve();
          } catch (error) {
            console.error("Error compressAndUploadToS3:", error);
            //reject(error);
        }

          //el truco para que este presignedURL funcione, es que el role de la lambda debe tener permisos de lectura, no solo de escritura
    const presignedUrl = await generatePresignedUrl(DELTABUCKET, s3Key, 60 * 60 * 24); // 1 dia?

        
        // // Retornar el PDF como respuesta
        // const response = {
        //     statusCode: 200,
        //     headers: {
        //         'Content-Type': 'application/pdf',
        //         'Content-Disposition': 'attachment; filename="holamundo.pdf"',
        //         'Content-Length': savedBuffer.length,
        //     },
        //     body: pdfBase64,
        //     isBase64Encoded: true,
        // };
        
        // Retornar el link al pdf como respuesta
       const response =  {
            'statusCode': 200,
            'body': JSON.stringify({
                downloadUrl: presignedUrl,
            })
        }

         // convert stream to b64
        //const b64 = buffer.toString('base64'); 
        // await browser.close();
        // res.send({ statusCode: 200, pdfData: b64 });
        // } catch (err) {
        // res.send({ statusCode: 500, userMessage: err });
        // }
// }

        // const response =  {
        //     'statusCode': 200,
        //     'body': JSON.stringify({
        //         result: 'success', browserVersion, pageTitle
        //     })
        // }


        console.log("Response:", response); 
        return response;
        
        //   await page.goto("https://www.example.com", { waitUntil: "networkidle0" });
        
        //   const browserVersion = await browser.version();
        //   const pageTitle = await page.title();
        
        //   await page.close();
        
        //   await browser.close();
        
        
        // return {
        //     'statusCode': 200,
        //     'body': JSON.stringify({
        //         result: 'success', browserVersion, pageTitle
        //     })
        // }

        //assert.strictEqual(pageTitle, "Example Domain");
        
        
        // console.log("Using remote Chromium");
        // const browser = await puppeteer.launch({
        //     args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
        //     defaultViewport: chromium.defaultViewport,
        //     executablePath: await chromium.executablePath(
        //         "https://github.com/Sparticuz/chromium/releases/download/v129.0.0/chromium-v129.0.0-pack.tar"
        //     ),
        //     headless: chromium.headless,
        //     ignoreHTTPSErrors: true,
        // });

        // console.log("Browser created");

        // const file = fs.readFileSync(path.resolve(__dirname, 'templates/template.hbs'), 'utf8')
    
        // const template = handlebars.compile(file)
        // const content = template()
        
        // console.log("Read content", content);

        // const page = await browser.newPage();
        // await page.setContent(content);
        // await page.emulateMediaType("screen");
        // console.info("Page settet");
        
        // const buffer = await page.pdf({ format: "A4" });
        // await page.close();
        // await browser?.close();
        // console.info("PDF generation finished");
        
        // //escribir el buffer en /tmp
        // fs.writeFileSync('/tmp/hello.pdf', buffer);
        // console.log("PDF written to /tmp/hello.pdf");



    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error generando PDF', details: err.message }),
        };
    }
};

async function generatePresignedUrl(bucketName, objectKey, expirationTimeInSeconds) {
    try {
      // Crear comando para obtener objeto desde S3
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      });
  
      // Generar URL pre-firmada
      const signedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: expirationTimeInSeconds,
      });
  
      console.log("Generated pre-signed URL:", signedUrl);
      return signedUrl;
    } catch (error) {
      console.error("Error generating pre-signed URL:", error);
      throw error;
    }
  }
