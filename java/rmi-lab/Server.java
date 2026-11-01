package lab.rmi;

import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;

public final class Server {
    public static void main(String[] args) throws Exception {
        Registry registry = LocateRegistry.createRegistry(1099);
        registry.rebind("CalculatorService", new CalculatorImpl());
        System.out.println("RMI registry ready: CalculatorService @ :1099");
    }
}
