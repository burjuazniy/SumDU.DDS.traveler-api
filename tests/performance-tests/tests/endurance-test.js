/**
 * ENDURANCE (SOAK) TEST - тривале помірне навантаження, 30 хвилин.
 * 300 VU; 20% створених планів лишаються в БД, тож таблиці ростуть
 * і видно вплив обсягу даних на швидкодію.
 */
import { userJourney } from '../utils/journey.js';

export const options = {
  stages: [
    { duration: '2m', target: 300 },
    { duration: '30m', target: 300 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  userJourney(1);
}
