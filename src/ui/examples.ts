import { Radix } from "utils/bits"

/**
 * Stores a snapshot of code, register, and memory settings
 */
export interface SimSetup {
    code?: string,
    memory?: string,
    registers?: Record<number, string>
    memoryRadix?: Radix,
    memoryWordSize?: number,
    registerRadix?: Radix,
}

export interface Example {
    name: string,
    description: string,
    url: string,
}

export const examples: Example[] = [
    {
        name: "Bubble Sort",
        description: "The bubble sort algorithm",
        url: require("assets/examples/bubbleSort.json"),
    }, {
        name: "Selection Sort",
        description: "The selection sort algorithm",
        url: require("assets/examples/selectionSort.json"),
    }, {
        name: "Insertion Sort",
        description: "Sorts the array in place",
        url: require("assets/examples/insertionSort.json"),
    }, {
        name: "Linear Search",
        description: "Finds the index of a value in the array",
        url: require("assets/examples/linearSearch.json"),
    }, {
        name: "Find Maximum",
        description: "Largest element of the array",
        url: require("assets/examples/findMaximum.json"),
    }, {
        name: "Fibonacci",
        description: "fib(10), computed iteratively",
        url: require("assets/examples/fibonacci.json"),
    }, {
        name: "Sum of Array",
        description: "Adds all elements and stores the total",
        url: require("assets/examples/sumOfArray.json"),
    }, {
        name: "Reverse Array",
        description: "Reverses the array in place",
        url: require("assets/examples/reverseArray.json"),
    }
]
