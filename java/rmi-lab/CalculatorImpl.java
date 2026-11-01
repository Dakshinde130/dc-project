package lab.rmi;

import java.rmi.RemoteException;
import java.rmi.server.UnicastRemoteObject;

public final class CalculatorImpl extends UnicastRemoteObject implements Calculator {
    public CalculatorImpl() throws RemoteException { super(); }

    @Override public double add(double a, double b) { return a + b; }
    @Override public double multiply(double a, double b) { return a * b; }
    @Override public long fibonacci(int n) {
        n = Math.max(0, Math.min(42, n));
        long a = 0, b = 1;
        for (int i = 0; i < n; i++) { long t = a + b; a = b; b = t; }
        return a;
    }
    @Override public String describe() {
        return "CalculatorImpl JVM=" + System.getProperty("java.version");
    }
}
