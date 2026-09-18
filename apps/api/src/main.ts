import "dotenv/config";
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";

@Module({ controllers: [CrmController], providers: [CrmService] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser("json", { limit: "2mb" });
  app.setGlobalPrefix("api");
  app.enableCors({ origin: process.env.WEB_ORIGIN || "http://localhost:3000" });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3001), "127.0.0.1");
}
void bootstrap();
