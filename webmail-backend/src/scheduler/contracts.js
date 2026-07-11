"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTransitionBooking = exports.SCHEDULER_BOOKING_STATUSES = void 0;
exports.SCHEDULER_BOOKING_STATUSES = [
    'requested',
    'confirmed',
    'rejected',
    'cancelled',
    'completed',
    'no_show',
];
const BOOKING_TRANSITIONS = {
    requested: ['confirmed', 'rejected', 'cancelled'],
    confirmed: ['cancelled', 'completed', 'no_show'],
    rejected: [],
    cancelled: [],
    completed: [],
    no_show: [],
};
const canTransitionBooking = ({ from, to }) => (BOOKING_TRANSITIONS[from].includes(to));
exports.canTransitionBooking = canTransitionBooking;
//# sourceMappingURL=contracts.js.map