import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class AppController {
  @Get()
  @Redirect('/ui/', 302)
  redirectToUi(): void {
    // The decorator handles the response.
  }
}
