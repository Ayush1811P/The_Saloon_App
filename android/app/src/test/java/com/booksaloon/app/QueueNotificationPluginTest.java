package com.booksaloon.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class QueueNotificationPluginTest {
    @Test
    public void preservesProgressForTheSameBooking() {
        assertEquals(42, QueueNotificationPlugin.progressForBooking("booking-1", "booking-1", 42));
    }

    @Test
    public void resetsProgressWhenTheBookingChanges() {
        assertEquals(0, QueueNotificationPlugin.progressForBooking("booking-2", "booking-1", 42));
    }
}
