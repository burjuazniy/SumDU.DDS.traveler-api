/**
 * Типова сесія користувача TravelerAPI, спільна для load/stress/spike/endurance тестів.
 * ~10 запитів: читання списку, CRUD плану, дві локації, оновлення локації.
 * 80% планів видаляються наприкінці, 20% лишаються - база поступово росте, як у реальності.
 */
import { sleep } from 'k6';
import {
  listTravelPlans, createTravelPlan, getTravelPlan, addLocation,
  updateTravelPlan, updateLocation, deleteTravelPlan,
} from './api-client.js';
import { generateTravelPlan, generateLocation } from './data-generator.js';

export function userJourney(thinkSeconds = 1) {
  listTravelPlans();

  const plan = createTravelPlan(generateTravelPlan());
  if (!plan) return;

  getTravelPlan(plan.id);
  const loc1 = addLocation(plan.id, generateLocation());
  addLocation(plan.id, generateLocation());

  const updated = updateTravelPlan(plan.id, { budget: 1500, version: plan.version });
  if (loc1) updateLocation(loc1.id, { notes: 'Tickets booked!' });

  getTravelPlan(plan.id);
  if (Math.random() < 0.8) deleteTravelPlan(plan.id);

  if (thinkSeconds > 0) sleep(thinkSeconds * (0.5 + Math.random()));
  return updated;
}
