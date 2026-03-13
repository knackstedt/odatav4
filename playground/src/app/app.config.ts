import { provideHttpClient, withFetch } from '@angular/common/http';
import { type ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';

export const appConfig: ApplicationConfig = {
    providers: [
        provideZoneChangeDetection({ eventCoalescing: true }),
        provideAnimationsAsync(),
        providePrimeNG({
            ripple: true,
        }),
        MessageService,
        ConfirmationService,
        provideHttpClient(withFetch()),
    ],
};
