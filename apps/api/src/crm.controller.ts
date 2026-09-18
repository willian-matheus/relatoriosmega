import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CrmService } from "./crm.service";
import { getSupabaseClient } from "./supabase";

@Controller()
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get("health")
  health() {
    return {
      status: "ok",
      storage: getSupabaseClient() ? "supabase" : "memory",
    };
  }

  @Get("workspace")
  async workspace() {
    return this.crm.snapshot();
  }

  @Post("opportunities")
  async create(@Body() body: unknown) {
    return this.crm.save(body);
  }

  @Patch("opportunities/:id")
  async update(@Param("id") id: string, @Body() body: unknown) {
    return this.crm.save(body, id);
  }

  @Patch("opportunities/:id/stage")
  async move(@Param("id") id: string, @Body() body: unknown) {
    return this.crm.move(id, body);
  }

  @Delete("opportunities/:id")
  async remove(@Param("id") id: string) {
    return this.crm.remove(id);
  }

  @Post("imports/preview")
  preview(@Body() body: unknown) {
    return this.crm.preview(body);
  }

  @Post("imports/:token/commit")
  async commit(@Param("token") token: string) {
    return this.crm.commit(token);
  }

  @Get("reports/:id/download")
  async download(@Param("id") id: string) {
    return this.crm.getReportDownloadUrl(id);
  }
}
