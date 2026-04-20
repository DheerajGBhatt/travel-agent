import { and, asc, eq, gte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { logger } from '../shared/logger.js';
import { getDb } from '../shared/db.js';
import { flights, airlines, airports } from '../shared/schema.js';
import {
  dispatch,
  type ApiGatewayV2HttpEvent,
  type ApiGatewayV2HttpResponse,
  type BedrockActionGroupEvent,
  type BedrockActionGroupResponse,
  type Routes,
} from '../shared/responses.js';
import { GetFlightStatusInput, SearchAlternateFlightsInput } from '../shared/schemas.js';

async function getFlightStatus(params: Record<string, string>) {
  const { flightId } = GetFlightStatusInput.parse(params);
  const depAirport = alias(airports, 'dep_airport');
  const arrAirport = alias(airports, 'arr_airport');
  const rows = await getDb()
    .select({
      flightId: flights.flightId,
      flightNumber: flights.flightNumber,
      airlineName: airlines.name,
      airlineCode: airlines.code,
      departureCode: depAirport.code,
      arrivalCode: arrAirport.code,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      status: flights.status,
    })
    .from(flights)
    .leftJoin(airlines, eq(flights.airlineId, airlines.airlineId))
    .leftJoin(depAirport, eq(flights.departureAirport, depAirport.airportId))
    .leftJoin(arrAirport, eq(flights.arrivalAirport, arrAirport.airportId))
    .where(eq(flights.flightId, flightId))
    .limit(1);
  if (rows.length === 0) {
    return {
      statusCode: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'Flight not found' } },
    };
  }
  return { statusCode: 200, body: { success: true, data: rows[0] } };
}

async function searchAlternates(params: Record<string, string>) {
  const { origin, destination, afterIso } = SearchAlternateFlightsInput.parse(params);
  const db = getDb();

  const originRows = await db
    .select({ airportId: airports.airportId })
    .from(airports)
    .where(eq(airports.code, origin))
    .limit(1);
  const destRows = await db
    .select({ airportId: airports.airportId })
    .from(airports)
    .where(eq(airports.code, destination))
    .limit(1);
  const originId = originRows[0]?.airportId;
  const destId = destRows[0]?.airportId;
  if (!originId || !destId) {
    return {
      statusCode: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'Airport code not found' } },
    };
  }

  const rows = await db
    .select({
      flightId: flights.flightId,
      flightNumber: flights.flightNumber,
      airlineCode: airlines.code,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      basePrice: flights.basePrice,
      availableSeats: flights.availableSeats,
      status: flights.status,
    })
    .from(flights)
    .leftJoin(airlines, eq(flights.airlineId, airlines.airlineId))
    .where(
      and(
        eq(flights.departureAirport, originId),
        eq(flights.arrivalAirport, destId),
        gte(flights.departureTime, new Date(afterIso)),
        eq(flights.status, 'scheduled'),
      ),
    )
    .orderBy(asc(flights.departureTime))
    .limit(10);
  return { statusCode: 200, body: { success: true, data: { results: rows } } };
}

const routes: Routes = {
  '/flights/status': getFlightStatus,
  '/flights/search': searchAlternates,
};

export const handler = async (
  event: BedrockActionGroupEvent | ApiGatewayV2HttpEvent,
): Promise<BedrockActionGroupResponse | ApiGatewayV2HttpResponse> => {
  logger.info('flights-actions invoked');
  return dispatch(event, routes);
};
