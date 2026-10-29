/**
 * LOAD TEST - очікуване робоче навантаження.
 * Ramp-up до 500 користувачів, 5 хвилин стабільно, ramp-down.
 * Кожен користувач - типова сесія (~10 запитів) з паузою ~1с між сесіями.
 */
import { userJourney } from '../utils/journey.js';

export const options = {
  stages: [
    { duration: '2m', target: 500 },
    { duration: '5m', target: 500 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  userJourney(1);
}
