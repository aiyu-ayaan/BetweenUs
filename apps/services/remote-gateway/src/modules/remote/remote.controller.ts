import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type {
  EnrolMachineResponse,
  RemoteAuditEntry,
  RemoteGrantSummary,
  RemoteMachineSummary,
  RemoteSessionResponse,
} from '@nexora/shared-types';
import { RemoteService } from './remote.service';
import {
  EnrolMachineDto,
  RenameMachineDto,
  SetRemoteGrantDto,
  StartRemoteSessionDto,
} from './dto';

/**
 * `/api/v1/remote`. Thin: every rule lives in RemoteService, and the socket
 * gateway is what carries a live session.
 */
@Controller('remote')
@UseGuards(JwtAuthGuard)
export class RemoteController {
  constructor(private readonly remote: RemoteService) {}

  @Get('machines')
  machines(@CurrentUser() user: AuthenticatedUser): Promise<RemoteMachineSummary[]> {
    return this.remote.machines(user.id);
  }

  /** The agent calls this once, signed in as the person who owns the machine. */
  @Post('machines')
  enrol(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EnrolMachineDto,
  ): Promise<EnrolMachineResponse> {
    return this.remote.enrol(user.id, dto);
  }

  @Patch('machines/:machineId')
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Body() dto: RenameMachineDto,
  ): Promise<RemoteMachineSummary> {
    return this.remote.rename(user.id, machineId, dto.name);
  }

  @Delete('machines/:machineId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('machineId', ParseUUIDPipe) machineId: string,
  ): Promise<void> {
    return this.remote.remove(user.id, machineId);
  }

  @Get('machines/:machineId/grants')
  grants(
    @CurrentUser() user: AuthenticatedUser,
    @Param('machineId', ParseUUIDPipe) machineId: string,
  ): Promise<RemoteGrantSummary[]> {
    return this.remote.grants(user.id, machineId);
  }

  /** One call sets or revokes; an empty permission list is the revocation. */
  @Put('machines/:machineId/grants')
  setGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Body() dto: SetRemoteGrantDto,
  ): Promise<RemoteGrantSummary[]> {
    return this.remote.setGrant(user.id, machineId, dto);
  }

  @Get('machines/:machineId/audit')
  audit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Query('limit') limit?: string,
  ): Promise<RemoteAuditEntry[]> {
    return this.remote.audit(user.id, machineId, limit ? Number(limit) : undefined);
  }

  @Post('sessions')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartRemoteSessionDto,
    // The address this client reached the deployment on, so the reply can refuse
    // to send it to a media server it cannot dial. Nginx forwards the original.
    @Headers('host') host?: string,
  ): Promise<RemoteSessionResponse> {
    return this.remote.startSession(user, dto.machineId, host);
  }

  /**
   * Ending over HTTP as well as over the socket: a window that was closed
   * without a clean disconnect still has to be able to say the session is over.
   */
  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.remote.endSessionFor(user.id, sessionId, 'controller');
  }
}
