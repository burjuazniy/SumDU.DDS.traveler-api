/**
 * STRESS TEST - пошук точки деградації та точки відмови.
 * Кроки по 1 хвилині: 200 -> 400 -> 800 -> 1200 -> 1600 -> 2000 -> 2500 VU,
 * потім 3 хвилини 100 VU для перевірки відновлення.
 */
import { userJourney } from '../utils/journey.js';

export const options = {
  stages: [
    { duration: '30s', target: 200 }, { duration: '1m', target: 200 },
    { duration: '30s', target: 400 }, { duration: '1m', target: 400 },
    { duration: '30s', target: 800 }, { duration: '1m', target: 800 },
    { duration: '30s', target: 1200 }, { duration: '1m', target: 1200 },
    { duration: '30s', target: 1600 }, { duration: '1m', target: 1600 },
    { duration: '30s', target: 2000 }, { duration: '1m', target: 2000 },
    { duration: '30s', target: 2500 }, { duration: '1m', target: 2500 },
    { duration: '30s', target: 100 }, { duration: '3m', target: 100 },  // recovery
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  userJourney(1);
}
