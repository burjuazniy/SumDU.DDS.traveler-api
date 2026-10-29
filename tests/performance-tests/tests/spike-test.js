/**
 * SPIKE TEST - різкі сплески навантаження.
 * Фон 100 VU, два сплески до 2000 VU за 10 секунд, між ними та після - відновлення.
 */
import { userJourney } from '../utils/journey.js';

export const options = {
  stages: [
    { duration: '30s', target: 100 }, { duration: '1m', target: 100 },   // baseline
    { duration: '10s', target: 2000 }, { duration: '1m', target: 2000 }, // spike 1
    { duration: '10s', target: 100 }, { duration: '1m30s', target: 100 }, // recovery 1
    { duration: '10s', target: 2000 }, { duration: '30s', target: 2000 }, // spike 2
    { duration: '10s', target: 100 }, { duration: '1m30s', target: 100 }, // recovery 2
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  userJourney(1);
}
