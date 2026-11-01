package lab.rmi;

import java.rmi.Remote;
import java.rmi.RemoteException;

public interface Calculator extends Remote {
    double add(double a, double b) throws RemoteException;
    double multiply(double a, double b) throws RemoteException;
    long fibonacci(int n) throws RemoteException;
    String describe() throws RemoteException;
}
